// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title MerklePriceOracle
 * @notice Trustless verification of 432K+ trading card prices using a single Merkle root.
 *
 * Architecture:
 *   - Mac Mini builds a Merkle tree from the full SQLite database (432K products)
 *   - Pushes the 32-byte root on-chain once per day (1 transaction)
 *   - Anyone can verify any price by submitting a Merkle proof
 *   - Companion to TCGPriceOracleV2 (top 50 live on-chain with TWAP)
 *
 * Leaf encoding:
 *   keccak256(bytes.concat(keccak256(abi.encode(productId, categoryId, name, marketPrice, lowPrice))))
 *
 *   Double-hash (OpenZeppelin standard) prevents second-preimage attacks on internal nodes.
 *
 * @author Meme Merchants — sailorpepe.eth
 * @custom:security-contact security@the-undesirables.com
 */
contract MerklePriceOracle is Ownable2Step, Pausable {

    /// @notice The current Merkle root committing to all product prices
    bytes32 public merkleRoot;

    /// @notice Timestamp of the last Merkle root update
    uint256 public lastRootUpdate;

    /// @notice Total number of products in the committed dataset
    uint256 public totalProducts;

    /// @notice Running count of root updates
    uint256 public totalRootUpdates;

    /// @notice Maximum staleness before the root is considered outdated (48 hours)
    uint256 public constant ROOT_STALENESS_THRESHOLD = 48 hours;

    /// @dev Historical roots for audit trail (rootIndex => root)
    mapping(uint256 => bytes32) public rootHistory;
    mapping(uint256 => uint256) public rootTimestamps;

    // ─── Events ───────────────────────────────────────────

    event MerkleRootUpdated(
        bytes32 indexed newRoot,
        uint256 totalProducts,
        uint256 indexed updateIndex,
        uint256 timestamp
    );

    event PriceVerified(
        uint256 indexed productId,
        uint256 marketPrice,
        address indexed verifier
    );

    // ─── Constructor ──────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ─── Owner Functions ──────────────────────────────────

    /**
     * @notice Update the Merkle root. Called by the Mac Mini cron job.
     * @param _root The new Merkle root
     * @param _totalProducts Number of products in the dataset
     */
    function updateMerkleRoot(
        bytes32 _root,
        uint256 _totalProducts
    ) external onlyOwner whenNotPaused {
        require(_root != bytes32(0), "Root cannot be zero");
        require(_totalProducts > 0, "Must have products");

        merkleRoot = _root;
        totalProducts = _totalProducts;
        lastRootUpdate = block.timestamp;

        rootHistory[totalRootUpdates] = _root;
        rootTimestamps[totalRootUpdates] = block.timestamp;
        totalRootUpdates++;

        emit MerkleRootUpdated(_root, _totalProducts, totalRootUpdates - 1, block.timestamp);
    }

    /// @notice Pause the contract (blocks root updates, reads still work)
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the contract
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice SECURITY: Finding #12 — Prevent accidental permanent lockout.
    function renounceOwnership() public override onlyOwner {
        revert("Cannot renounce ownership");
    }

    // ─── Verification Functions ───────────────────────────

    /**
     * @notice Verify that a product's price is included in the committed dataset.
     * @param _productId TCGPlayer product ID
     * @param _categoryId Game category (3=Pokemon, 2=Magic, etc.)
     * @param _name Product name
     * @param _marketPrice Market price in cents
     * @param _lowPrice Low price in cents
     * @param _proof Merkle proof (array of sibling hashes)
     * @return valid True if the price is verified against the current root
     */
    function verifyPrice(
        uint256 _productId,
        uint256 _categoryId,
        string calldata _name,
        uint256 _marketPrice,
        uint256 _lowPrice,
        bytes32[] calldata _proof
    ) external view returns (bool valid) {
        require(merkleRoot != bytes32(0), "No root set");

        bytes32 leaf = keccak256(
            bytes.concat(
                keccak256(abi.encode(_productId, _categoryId, _name, _marketPrice, _lowPrice))
            )
        );

        valid = MerkleProof.verify(_proof, merkleRoot, leaf);

        return valid;
    }

    /**
     * @notice Verify a price and emit an event (for on-chain proof of verification).
     * @dev Same as verifyPrice but writes an event. Costs gas but creates a record.
     */
    function verifyAndRecord(
        uint256 _productId,
        uint256 _categoryId,
        string calldata _name,
        uint256 _marketPrice,
        uint256 _lowPrice,
        bytes32[] calldata _proof
    ) external returns (bool valid) {
        require(merkleRoot != bytes32(0), "No root set");

        bytes32 leaf = keccak256(
            bytes.concat(
                keccak256(abi.encode(_productId, _categoryId, _name, _marketPrice, _lowPrice))
            )
        );

        valid = MerkleProof.verify(_proof, merkleRoot, leaf);
        require(valid, "Invalid proof");

        emit PriceVerified(_productId, _marketPrice, msg.sender);

        return true;
    }

    // ─── Read Functions ───────────────────────────────────

    /**
     * @notice Check if the current Merkle root is fresh (updated within threshold)
     * @return True if the root was updated within ROOT_STALENESS_THRESHOLD
     */
    function isRootFresh() external view returns (bool) {
        if (lastRootUpdate == 0) return false;
        return (block.timestamp - lastRootUpdate) <= ROOT_STALENESS_THRESHOLD;
    }

    /**
     * @notice Get a historical root by index
     * @param _index The root update index (0-based)
     * @return root The Merkle root at that index
     * @return timestamp When it was submitted
     */
    function getRootAtIndex(uint256 _index) external view returns (bytes32 root, uint256 timestamp) {
        require(_index < totalRootUpdates, "Index out of bounds");
        return (rootHistory[_index], rootTimestamps[_index]);
    }

    /**
     * @notice Compute the leaf hash for a product (utility for off-chain tooling)
     * @dev Matches the leaf encoding used in verifyPrice
     */
    function computeLeaf(
        uint256 _productId,
        uint256 _categoryId,
        string calldata _name,
        uint256 _marketPrice,
        uint256 _lowPrice
    ) external pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                keccak256(abi.encode(_productId, _categoryId, _name, _marketPrice, _lowPrice))
            )
        );
    }
}
