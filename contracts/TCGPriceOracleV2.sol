// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title TCGPriceOracleV2
 * @author The Undesirables LLC
 * @notice On-chain price oracle for blue-chip trading card products.
 *         Tracks the top 50 products across 7+ TCG categories with hourly
 *         on-chain updates and a 24-period TWAP ring buffer.
 *
 * @dev Deployed on LitVM LiteForge Testnet (Chain ID 4441).
 *
 *      Architecture:
 *        Off-chain pipeline (TCGCSV → SQLite → Python cron) pushes prices
 *        to this contract every hour via batchUpdatePricesOnly(). The
 *        contract stores the latest snapshot AND a 24-period ring buffer
 *        for TWAP calculations.
 *
 *      Security decisions:
 *        - Ownable2Step (not Ownable) — prevents accidental ownership transfer
 *          to a wrong address. New owner must call acceptOwnership().
 *        - Pausable — emergency kill switch if data pipeline is compromised.
 *        - No proxy/upgrade pattern — immutable deployment. If we need changes,
 *          we deploy a new contract. Simpler = safer.
 *        - No assembly, no delegatecall, no external calls to untrusted contracts.
 *        - Batch size capped at 100 to prevent out-of-gas griefing.
 *        - All state changes emit events for off-chain indexing.
 *
 *      Gas optimization:
 *        - batchUpdatePricesOnly() skips name/category storage for hourly
 *          refreshes (names don't change hourly). Saves ~60% gas vs full batch.
 *        - PriceObservation packs price + timestamp into a single storage slot
 *          using uint128 + uint64 + uint64 = 256 bits.
 *        - Ring buffer uses modular arithmetic instead of dynamic arrays.
 */
contract TCGPriceOracleV2 is Ownable2Step, Pausable {

    // ─── Structs ──────────────────────────────────────────────

    /// @notice Full product record stored in the main registry.
    struct Product {
        uint256 productId;      // TCGPlayer product ID (e.g., 98580)
        uint256 categoryId;     // TCGPlayer category (2=Magic, 3=Pokemon, etc.)
        string  name;           // Human-readable product name
        uint256 marketPrice;    // Current market price in USD cents
        uint256 lowPrice;       // Current low (buy-it-now) price in USD cents
        uint256 timestamp;      // Block timestamp of last update
    }

    /// @notice Compact price observation for the TWAP ring buffer.
    /// @dev Packed into a single 256-bit storage slot:
    ///      uint128 (price) + uint64 (timestamp) + uint64 (epoch) = 256 bits
    struct PriceObservation {
        uint128 marketPrice;    // USD cents — max ~3.4×10^38, well above any card price
        uint64  timestamp;      // Unix timestamp — good until year 584,942,417,355
        uint64  epoch;          // Monotonic update counter for ordering
    }

    // ─── Constants ────────────────────────────────────────────

    /// @notice Number of observations stored per product in the ring buffer.
    /// @dev 24 slots = 24 hourly observations = 1 full day of TWAP data.
    ///      Storage cost: 24 slots × 50 products = 1,200 storage slots.
    uint8 public constant RING_SIZE = 24;

    /// @notice Maximum age (in seconds) before a price is considered stale.
    /// @dev 2 hours = 7200 seconds. The cron pushes hourly, so anything
    ///      older than 2 hours means the pipeline missed a cycle.
    uint256 public constant STALENESS_THRESHOLD = 2 hours;

    /// @notice Maximum number of products in a single batch update.
    /// @dev Prevents out-of-gas failures from unbounded loops.
    uint256 public constant MAX_BATCH_SIZE = 100;

    // ─── State ────────────────────────────────────────────────

    /// @notice Total number of unique products registered in the oracle.
    uint256 public productCount;

    /// @notice Total number of individual price updates across all products.
    /// @dev Increments by 1 per product updated, not per batch call.
    uint256 public totalUpdates;

    /// @notice Main product registry. Maps sequential index → Product.
    mapping(uint256 => Product) private _products;

    /// @notice Reverse lookup: TCGPlayer productId → sequential index.
    mapping(uint256 => uint256) private _productIndex;

    /// @notice Existence check for product IDs.
    /// @dev Solves the V1 bug where index 0 was ambiguous (default value
    ///      for unregistered products collided with the first product).
    mapping(uint256 => bool) private _productExists;

    /// @notice TWAP ring buffer: productId → fixed-size array of observations.
    /// @dev Each product maintains its own independent ring buffer.
    mapping(uint256 => PriceObservation[24]) private _priceHistory;

    /// @notice Current write position in each product's ring buffer.
    mapping(uint256 => uint8) private _ringHead;

    // ─── Events ───────────────────────────────────────────────

    /// @notice Emitted when a single product's price is updated.
    event PriceUpdated(
        uint256 indexed productId,
        uint256 marketPrice,
        uint256 lowPrice,
        uint256 timestamp
    );

    /// @notice Emitted after a batch update completes.
    /// @param count Number of products updated in this batch.
    event BatchUpdated(uint256 count, uint256 timestamp);

    /// @notice Emitted when a new product is added to the registry.
    event ProductAdded(uint256 indexed productId, string name, uint256 categoryId);

    // ─── Constructor ──────────────────────────────────────────

    /// @notice Deploys the oracle with the caller as initial owner.
    /// @dev Ownable2Step requires acceptOwnership() for ownership transfers.
    constructor() Ownable(msg.sender) {}

    // ─── Core: Single Update ──────────────────────────────────

    /// @notice Update a single product's full record (price + metadata).
    /// @dev Use this for initial registration or when name/category changes.
    ///      For routine hourly updates, use batchUpdatePricesOnly() instead.
    /// @param _productId   TCGPlayer product ID
    /// @param _categoryId  TCGPlayer category ID
    /// @param _name        Human-readable product name
    /// @param _marketPrice Current market price in USD cents
    /// @param _lowPrice    Current low price in USD cents
    function updatePrice(
        uint256 _productId,
        uint256 _categoryId,
        string calldata _name,
        uint256 _marketPrice,
        uint256 _lowPrice
    ) external onlyOwner whenNotPaused {
        _upsertProduct(_productId, _categoryId, _name, _marketPrice, _lowPrice);
        emit PriceUpdated(_productId, _marketPrice, _lowPrice, block.timestamp);
    }

    // ─── Core: Batch Registration ─────────────────────────────

    /// @notice Register or update multiple products with full metadata.
    /// @dev Use this for initial bulk registration. For hourly price
    ///      refreshes where names don't change, use batchUpdatePricesOnly().
    /// @param _productIds   Array of TCGPlayer product IDs
    /// @param _categoryIds  Array of category IDs (must match length)
    /// @param _names        Array of product names (must match length)
    /// @param _marketPrices Array of market prices in USD cents
    /// @param _lowPrices    Array of low prices in USD cents
    function batchRegister(
        uint256[] calldata _productIds,
        uint256[] calldata _categoryIds,
        string[]  calldata _names,
        uint256[] calldata _marketPrices,
        uint256[] calldata _lowPrices
    ) external onlyOwner whenNotPaused {
        uint256 len = _productIds.length;
        require(
            len == _categoryIds.length &&
            len == _names.length &&
            len == _marketPrices.length &&
            len == _lowPrices.length,
            "Array length mismatch"
        );
        require(len <= MAX_BATCH_SIZE, "Batch too large");

        for (uint256 i = 0; i < len; i++) {
            _upsertProduct(
                _productIds[i],
                _categoryIds[i],
                _names[i],
                _marketPrices[i],
                _lowPrices[i]
            );
            emit PriceUpdated(
                _productIds[i],
                _marketPrices[i],
                _lowPrices[i],
                block.timestamp
            );
        }
        emit BatchUpdated(len, block.timestamp);
    }

    // ─── Core: Batch Price-Only Update ────────────────────────

    /// @notice Update prices for existing products without re-sending names.
    /// @dev This is the primary function called by the hourly cron job.
    ///      Saves ~60% gas vs batchRegister() by skipping string storage.
    ///      Silently skips any productId that hasn't been registered yet.
    /// @param _productIds   Array of TCGPlayer product IDs (must exist)
    /// @param _marketPrices Array of market prices in USD cents
    /// @param _lowPrices    Array of low prices in USD cents
    function batchUpdatePricesOnly(
        uint256[] calldata _productIds,
        uint256[] calldata _marketPrices,
        uint256[] calldata _lowPrices
    ) external onlyOwner whenNotPaused {
        uint256 len = _productIds.length;
        require(
            len == _marketPrices.length && len == _lowPrices.length,
            "Array length mismatch"
        );
        require(len <= MAX_BATCH_SIZE, "Batch too large");

        uint256 updated = 0;
        for (uint256 i = 0; i < len; i++) {
            uint256 pid = _productIds[i];
            if (!_productExists[pid]) continue; // skip unregistered

            uint256 idx = _productIndex[pid];
            Product storage p = _products[idx];
            p.marketPrice = _marketPrices[i];
            p.lowPrice    = _lowPrices[i];
            p.timestamp   = block.timestamp;

            // Write to TWAP ring buffer
            _writeObservation(pid, _marketPrices[i]);

            totalUpdates++;
            updated++;

            emit PriceUpdated(pid, _marketPrices[i], _lowPrices[i], block.timestamp);
        }
        if (updated > 0) {
            emit BatchUpdated(updated, block.timestamp);
        }
    }

    // ─── Consumer Interface ───────────────────────────────────
    //
    // These functions are designed for other smart contracts to call.
    // They follow a similar pattern to Chainlink's AggregatorV3Interface
    // so developers familiar with Chainlink can integrate easily.

    /// @notice Get the latest price for a product.
    /// @dev This is the primary function other protocols should call.
    /// @param _productId TCGPlayer product ID
    /// @return price     Market price in USD cents
    /// @return timestamp Block timestamp of the last update
    /// @return isFresh   True if the price was updated within STALENESS_THRESHOLD
    function getLatestPrice(uint256 _productId) external view returns (
        uint256 price,
        uint256 timestamp,
        bool    isFresh
    ) {
        require(_productExists[_productId], "Product not found");
        Product storage p = _products[_productIndex[_productId]];
        return (
            p.marketPrice,
            p.timestamp,
            block.timestamp - p.timestamp < STALENESS_THRESHOLD
        );
    }

    /// @notice Check if a product's price is fresh (updated recently).
    /// @param _productId TCGPlayer product ID
    /// @return True if updated within STALENESS_THRESHOLD, false otherwise
    function isPriceFresh(uint256 _productId) external view returns (bool) {
        if (!_productExists[_productId]) return false;
        return block.timestamp - _products[_productIndex[_productId]].timestamp
               < STALENESS_THRESHOLD;
    }

    /// @notice Calculate Time-Weighted Average Price over N periods.
    /// @dev Reads the ring buffer backwards from the most recent observation.
    ///      Skips empty slots (returns average of available data only).
    /// @param _productId TCGPlayer product ID
    /// @param _periods   Number of observations to average (1–24)
    /// @return Average market price in USD cents
    function getTWAP(uint256 _productId, uint8 _periods) external view returns (uint256) {
        require(_productExists[_productId], "Product not found");
        require(_periods > 0 && _periods <= RING_SIZE, "Periods must be 1-24");

        uint8 head = _ringHead[_productId];
        uint256 sum = 0;
        uint256 validCount = 0;

        for (uint8 i = 0; i < _periods; i++) {
            // Walk backwards from most recent observation
            uint8 pos = (head + RING_SIZE - 1 - i) % RING_SIZE;
            PriceObservation storage obs = _priceHistory[_productId][pos];
            if (obs.timestamp > 0) {
                sum += uint256(obs.marketPrice);
                validCount++;
            }
        }

        require(validCount > 0, "No price history available");
        return sum / validCount;
    }

    // ─── Read Functions ───────────────────────────────────────

    /// @notice Get a product by its sequential index (0-based).
    /// @param _index Sequential index (0 to productCount-1)
    /// @return Full Product struct
    function getProduct(uint256 _index) external view returns (Product memory) {
        require(_index < productCount, "Index out of bounds");
        return _products[_index];
    }

    /// @notice Look up a product directly by its TCGPlayer product ID.
    /// @param _productId TCGPlayer product ID
    /// @return Full Product struct
    function getProductById(uint256 _productId) external view returns (Product memory) {
        require(_productExists[_productId], "Product not found");
        return _products[_productIndex[_productId]];
    }

    /// @notice Get all products in a single call.
    /// @dev Gas-intensive for large product counts. Use getProduct() for
    ///      targeted reads in production integrations.
    /// @return Array of all Product structs
    function getAllProducts() external view returns (Product[] memory) {
        Product[] memory result = new Product[](productCount);
        for (uint256 i = 0; i < productCount; i++) {
            result[i] = _products[i];
        }
        return result;
    }

    /// @notice Get the full TWAP ring buffer for a product.
    /// @dev Returns all 24 slots. Empty slots have timestamp = 0.
    /// @param _productId TCGPlayer product ID
    /// @return Array of 24 PriceObservation structs
    function getPriceHistory(uint256 _productId)
        external view returns (PriceObservation[24] memory)
    {
        require(_productExists[_productId], "Product not found");
        PriceObservation[24] memory result;
        for (uint8 i = 0; i < RING_SIZE; i++) {
            result[i] = _priceHistory[_productId][i];
        }
        return result;
    }

    /// @notice Check if a product ID is registered in the oracle.
    /// @param _productId TCGPlayer product ID
    /// @return True if the product exists
    function productExists(uint256 _productId) external view returns (bool) {
        return _productExists[_productId];
    }

    // ─── Admin ────────────────────────────────────────────────

    /// @notice Pause all price updates. Read functions remain available.
    /// @dev Use in emergency if data pipeline is compromised.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume price updates after a pause.
    function unpause() external onlyOwner {
        _unpause();
    }

    // ─── Internal ─────────────────────────────────────────────

    /// @dev Insert or update a product in the registry and ring buffer.
    function _upsertProduct(
        uint256 _productId,
        uint256 _categoryId,
        string calldata _name,
        uint256 _marketPrice,
        uint256 _lowPrice
    ) internal {
        uint256 idx;
        if (!_productExists[_productId]) {
            idx = productCount;
            _productIndex[_productId] = idx;
            _productExists[_productId] = true;
            productCount++;
            emit ProductAdded(_productId, _name, _categoryId);
        } else {
            idx = _productIndex[_productId];
        }

        _products[idx] = Product({
            productId:   _productId,
            categoryId:  _categoryId,
            name:        _name,
            marketPrice: _marketPrice,
            lowPrice:    _lowPrice,
            timestamp:   block.timestamp
        });

        _writeObservation(_productId, _marketPrice);
        totalUpdates++;
    }

    /// @dev Write a price observation to the product's ring buffer.
    function _writeObservation(uint256 _productId, uint256 _price) internal {
        uint8 head = _ringHead[_productId];
        _priceHistory[_productId][head] = PriceObservation({
            marketPrice: uint128(_price),
            timestamp:   uint64(block.timestamp),
            epoch:       uint64(totalUpdates)
        });
        _ringHead[_productId] = (head + 1) % RING_SIZE;
    }
}
