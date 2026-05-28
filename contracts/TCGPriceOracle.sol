// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title TCGPriceOracle
 * @notice On-chain price feed for trading card products
 * @dev Deployed on LitVM LiteForge (Chain ID 4441)
 *      Address: 0xA79C6b3922949fcaBb518f56f0B6e68Ca7115771
 */
contract TCGPriceOracle {
    struct Product {
        uint256 productId;
        uint256 categoryId;
        string name;
        uint256 marketPrice;  // in cents (USD * 100)
        uint256 lowPrice;     // in cents
        uint256 timestamp;
    }

    address public owner;
    uint256 public productCount;
    uint256 public totalUpdates;

    mapping(uint256 => Product) public products;  // index => Product
    mapping(uint256 => uint256) public productIndex;  // productId => index

    event PriceUpdated(uint256 indexed productId, uint256 marketPrice, uint256 lowPrice);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function updatePrice(
        uint256 _productId,
        uint256 _categoryId,
        string calldata _name,
        uint256 _marketPrice,
        uint256 _lowPrice
    ) external onlyOwner {
        uint256 idx = productIndex[_productId];
        if (idx == 0 && (productCount == 0 || products[0].productId != _productId)) {
            idx = productCount;
            productIndex[_productId] = idx;
            productCount++;
        }

        products[idx] = Product({
            productId: _productId,
            categoryId: _categoryId,
            name: _name,
            marketPrice: _marketPrice,
            lowPrice: _lowPrice,
            timestamp: block.timestamp
        });

        totalUpdates++;
        emit PriceUpdated(_productId, _marketPrice, _lowPrice);
    }

    function getProduct(uint256 _index) external view returns (Product memory) {
        require(_index < productCount, "Index out of bounds");
        return products[_index];
    }

    function getAllProducts() external view returns (Product[] memory) {
        Product[] memory result = new Product[](productCount);
        for (uint256 i = 0; i < productCount; i++) {
            result[i] = products[i];
        }
        return result;
    }
}
