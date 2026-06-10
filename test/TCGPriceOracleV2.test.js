const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("TCGPriceOracleV2", function () {
  let oracle;
  let owner, other, newOwner;

  // Sample product data (real TCGPlayer IDs and prices from our database)
  const CHARIZARD = {
    productId: 98580,
    categoryId: 3,        // Pokemon
    name: "Pokemon Base Set (Shadowless) [1st Edition] Booster Pack",
    marketPrice: 1875000,  // $18,750.00 in cents
    lowPrice: 1750000,     // $17,500.00
  };

  const EVOLVING_SKIES = {
    productId: 248124,
    categoryId: 3,
    name: "Evolving Skies Booster Box Case",
    marketPrice: 1484715,  // $14,847.15
    lowPrice: 2000000,
  };

  const REVISED_BOX = {
    productId: 618895,
    categoryId: 2,          // Magic
    name: "Revised Edition - Booster Box",
    marketPrice: 2650000,   // $26,500.00
    lowPrice: 2300000,
  };

  beforeEach(async function () {
    [owner, other, newOwner] = await ethers.getSigners();
    const OracleFactory = await ethers.getContractFactory("TCGPriceOracleV2");
    oracle = await OracleFactory.deploy();
    await oracle.waitForDeployment();
  });

  // ─── Deployment ─────────────────────────────────────────────

  describe("Deployment", function () {
    it("should set the deployer as owner", async function () {
      expect(await oracle.owner()).to.equal(owner.address);
    });

    it("should start with zero products", async function () {
      expect(await oracle.productCount()).to.equal(0);
    });

    it("should start with zero total updates", async function () {
      expect(await oracle.totalUpdates()).to.equal(0);
    });

    it("should not be paused", async function () {
      expect(await oracle.paused()).to.equal(false);
    });

    it("should have correct constants", async function () {
      expect(await oracle.RING_SIZE()).to.equal(24);
      expect(await oracle.STALENESS_THRESHOLD()).to.equal(2 * 60 * 60); // 2 hours
      expect(await oracle.MAX_BATCH_SIZE()).to.equal(100);
    });
  });

  // ─── Single Update ──────────────────────────────────────────

  describe("updatePrice (single)", function () {
    it("should register a new product", async function () {
      await oracle.updatePrice(
        CHARIZARD.productId,
        CHARIZARD.categoryId,
        CHARIZARD.name,
        CHARIZARD.marketPrice,
        CHARIZARD.lowPrice
      );

      expect(await oracle.productCount()).to.equal(1);
      expect(await oracle.totalUpdates()).to.equal(1);
      expect(await oracle.productExists(CHARIZARD.productId)).to.equal(true);
    });

    it("should store correct product data", async function () {
      await oracle.updatePrice(
        CHARIZARD.productId,
        CHARIZARD.categoryId,
        CHARIZARD.name,
        CHARIZARD.marketPrice,
        CHARIZARD.lowPrice
      );

      const product = await oracle.getProductById(CHARIZARD.productId);
      expect(product.productId).to.equal(CHARIZARD.productId);
      expect(product.categoryId).to.equal(CHARIZARD.categoryId);
      expect(product.name).to.equal(CHARIZARD.name);
      expect(product.marketPrice).to.equal(CHARIZARD.marketPrice);
      expect(product.lowPrice).to.equal(CHARIZARD.lowPrice);
    });

    it("should update an existing product without changing productCount", async function () {
      await oracle.updatePrice(
        CHARIZARD.productId,
        CHARIZARD.categoryId,
        CHARIZARD.name,
        CHARIZARD.marketPrice,
        CHARIZARD.lowPrice
      );

      const newPrice = 1900000; // price went up
      await oracle.updatePrice(
        CHARIZARD.productId,
        CHARIZARD.categoryId,
        CHARIZARD.name,
        newPrice,
        CHARIZARD.lowPrice
      );

      expect(await oracle.productCount()).to.equal(1);   // still 1 product
      expect(await oracle.totalUpdates()).to.equal(2);    // 2 updates total

      const product = await oracle.getProductById(CHARIZARD.productId);
      expect(product.marketPrice).to.equal(newPrice);
    });

    it("should emit PriceUpdated event", async function () {
      await expect(
        oracle.updatePrice(
          CHARIZARD.productId,
          CHARIZARD.categoryId,
          CHARIZARD.name,
          CHARIZARD.marketPrice,
          CHARIZARD.lowPrice
        )
      ).to.emit(oracle, "PriceUpdated");
    });

    it("should emit ProductAdded event for new products", async function () {
      await expect(
        oracle.updatePrice(
          CHARIZARD.productId,
          CHARIZARD.categoryId,
          CHARIZARD.name,
          CHARIZARD.marketPrice,
          CHARIZARD.lowPrice
        )
      ).to.emit(oracle, "ProductAdded");
    });

    it("should NOT emit ProductAdded when updating existing product", async function () {
      await oracle.updatePrice(
        CHARIZARD.productId,
        CHARIZARD.categoryId,
        CHARIZARD.name,
        CHARIZARD.marketPrice,
        CHARIZARD.lowPrice
      );

      await expect(
        oracle.updatePrice(
          CHARIZARD.productId,
          CHARIZARD.categoryId,
          CHARIZARD.name,
          1900000,
          CHARIZARD.lowPrice
        )
      ).to.not.emit(oracle, "ProductAdded");
    });

    it("should reject non-owner calls", async function () {
      await expect(
        oracle.connect(other).updatePrice(
          CHARIZARD.productId,
          CHARIZARD.categoryId,
          CHARIZARD.name,
          CHARIZARD.marketPrice,
          CHARIZARD.lowPrice
        )
      ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
    });
  });

  // ─── Batch Registration ─────────────────────────────────────

  describe("batchRegister", function () {
    it("should register multiple products in one transaction", async function () {
      await oracle.batchRegister(
        [CHARIZARD.productId, EVOLVING_SKIES.productId, REVISED_BOX.productId],
        [CHARIZARD.categoryId, EVOLVING_SKIES.categoryId, REVISED_BOX.categoryId],
        [CHARIZARD.name, EVOLVING_SKIES.name, REVISED_BOX.name],
        [CHARIZARD.marketPrice, EVOLVING_SKIES.marketPrice, REVISED_BOX.marketPrice],
        [CHARIZARD.lowPrice, EVOLVING_SKIES.lowPrice, REVISED_BOX.lowPrice]
      );

      expect(await oracle.productCount()).to.equal(3);
      expect(await oracle.totalUpdates()).to.equal(3);

      const p1 = await oracle.getProductById(CHARIZARD.productId);
      expect(p1.name).to.equal(CHARIZARD.name);

      const p2 = await oracle.getProductById(REVISED_BOX.productId);
      expect(p2.marketPrice).to.equal(REVISED_BOX.marketPrice);
    });

    it("should emit BatchUpdated event", async function () {
      await expect(
        oracle.batchRegister(
          [CHARIZARD.productId, EVOLVING_SKIES.productId],
          [CHARIZARD.categoryId, EVOLVING_SKIES.categoryId],
          [CHARIZARD.name, EVOLVING_SKIES.name],
          [CHARIZARD.marketPrice, EVOLVING_SKIES.marketPrice],
          [CHARIZARD.lowPrice, EVOLVING_SKIES.lowPrice]
        )
      ).to.emit(oracle, "BatchUpdated");
    });

    it("should reject mismatched array lengths", async function () {
      await expect(
        oracle.batchRegister(
          [CHARIZARD.productId, EVOLVING_SKIES.productId],
          [CHARIZARD.categoryId],  // wrong length
          [CHARIZARD.name, EVOLVING_SKIES.name],
          [CHARIZARD.marketPrice, EVOLVING_SKIES.marketPrice],
          [CHARIZARD.lowPrice, EVOLVING_SKIES.lowPrice]
        )
      ).to.be.revertedWith("Array length mismatch");
    });

    it("should reject batches larger than MAX_BATCH_SIZE", async function () {
      const ids = Array.from({ length: 101 }, (_, i) => i + 1);
      const cats = Array(101).fill(3);
      const names = Array(101).fill("Test");
      const prices = Array(101).fill(100);
      const lows = Array(101).fill(50);

      await expect(
        oracle.batchRegister(ids, cats, names, prices, lows)
      ).to.be.revertedWith("Batch too large");
    });

    it("should reject non-owner calls", async function () {
      await expect(
        oracle.connect(other).batchRegister(
          [CHARIZARD.productId],
          [CHARIZARD.categoryId],
          [CHARIZARD.name],
          [CHARIZARD.marketPrice],
          [CHARIZARD.lowPrice]
        )
      ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
    });
  });

  // ─── Batch Price-Only Update ────────────────────────────────

  describe("batchUpdatePricesOnly", function () {
    beforeEach(async function () {
      // Register products first
      await oracle.batchRegister(
        [CHARIZARD.productId, EVOLVING_SKIES.productId, REVISED_BOX.productId],
        [CHARIZARD.categoryId, EVOLVING_SKIES.categoryId, REVISED_BOX.categoryId],
        [CHARIZARD.name, EVOLVING_SKIES.name, REVISED_BOX.name],
        [CHARIZARD.marketPrice, EVOLVING_SKIES.marketPrice, REVISED_BOX.marketPrice],
        [CHARIZARD.lowPrice, EVOLVING_SKIES.lowPrice, REVISED_BOX.lowPrice]
      );
    });

    it("should update prices without changing names", async function () {
      const newPrices = [1900000, 1500000, 2700000];
      const newLows = [1800000, 1400000, 2500000];

      await oracle.batchUpdatePricesOnly(
        [CHARIZARD.productId, EVOLVING_SKIES.productId, REVISED_BOX.productId],
        newPrices,
        newLows
      );

      const p = await oracle.getProductById(CHARIZARD.productId);
      expect(p.marketPrice).to.equal(1900000);
      expect(p.name).to.equal(CHARIZARD.name); // name unchanged
    });

    it("should silently skip unregistered product IDs", async function () {
      const fakeProductId = 999999;

      await oracle.batchUpdatePricesOnly(
        [CHARIZARD.productId, fakeProductId],
        [1900000, 500000],
        [1800000, 400000]
      );

      // Charizard should be updated
      const p = await oracle.getProductById(CHARIZARD.productId);
      expect(p.marketPrice).to.equal(1900000);

      // Fake product should not exist
      expect(await oracle.productExists(fakeProductId)).to.equal(false);
      expect(await oracle.productCount()).to.equal(3); // still 3
    });

    it("should increment totalUpdates per product, not per batch", async function () {
      const before = await oracle.totalUpdates();

      await oracle.batchUpdatePricesOnly(
        [CHARIZARD.productId, EVOLVING_SKIES.productId],
        [1900000, 1500000],
        [1800000, 1400000]
      );

      const after = await oracle.totalUpdates();
      expect(after - before).to.equal(2n); // 2 products updated
    });

    it("should reject mismatched array lengths", async function () {
      await expect(
        oracle.batchUpdatePricesOnly(
          [CHARIZARD.productId, EVOLVING_SKIES.productId],
          [1900000],  // wrong length
          [1800000, 1400000]
        )
      ).to.be.revertedWith("Array length mismatch");
    });
  });

  // ─── Consumer Interface ─────────────────────────────────────

  describe("Consumer Interface", function () {
    beforeEach(async function () {
      await oracle.updatePrice(
        CHARIZARD.productId,
        CHARIZARD.categoryId,
        CHARIZARD.name,
        CHARIZARD.marketPrice,
        CHARIZARD.lowPrice
      );
    });

    describe("getLatestPrice", function () {
      it("should return correct price and freshness", async function () {
        const [price, timestamp, isFresh] = await oracle.getLatestPrice(CHARIZARD.productId);
        expect(price).to.equal(CHARIZARD.marketPrice);
        expect(timestamp).to.be.gt(0);
        expect(isFresh).to.equal(true);
      });

      it("should report stale after STALENESS_THRESHOLD", async function () {
        // Fast-forward 3 hours
        await time.increase(3 * 60 * 60);

        const [price, , isFresh] = await oracle.getLatestPrice(CHARIZARD.productId);
        expect(price).to.equal(CHARIZARD.marketPrice);
        expect(isFresh).to.equal(false);
      });

      it("should revert for non-existent product", async function () {
        await expect(
          oracle.getLatestPrice(999999)
        ).to.be.revertedWith("Product not found");
      });
    });

    describe("isPriceFresh", function () {
      it("should return true for recently updated product", async function () {
        expect(await oracle.isPriceFresh(CHARIZARD.productId)).to.equal(true);
      });

      it("should return false after staleness threshold", async function () {
        await time.increase(3 * 60 * 60);
        expect(await oracle.isPriceFresh(CHARIZARD.productId)).to.equal(false);
      });

      it("should return false for non-existent product (not revert)", async function () {
        expect(await oracle.isPriceFresh(999999)).to.equal(false);
      });
    });
  });

  // ─── TWAP Ring Buffer ───────────────────────────────────────

  describe("TWAP Ring Buffer", function () {
    it("should store observations on each update", async function () {
      await oracle.updatePrice(
        CHARIZARD.productId,
        CHARIZARD.categoryId,
        CHARIZARD.name,
        CHARIZARD.marketPrice,
        CHARIZARD.lowPrice
      );

      const history = await oracle.getPriceHistory(CHARIZARD.productId);
      expect(history[0].marketPrice).to.equal(CHARIZARD.marketPrice);
      expect(history[0].timestamp).to.be.gt(0);
    });

    it("should calculate correct TWAP for single observation", async function () {
      await oracle.updatePrice(
        CHARIZARD.productId,
        CHARIZARD.categoryId,
        CHARIZARD.name,
        CHARIZARD.marketPrice,
        CHARIZARD.lowPrice
      );

      const twap = await oracle.getTWAP(CHARIZARD.productId, 1);
      expect(twap).to.equal(CHARIZARD.marketPrice);
    });

    it("should calculate correct TWAP for multiple observations", async function () {
      // Register product
      await oracle.updatePrice(
        CHARIZARD.productId, CHARIZARD.categoryId, CHARIZARD.name,
        1000000, CHARIZARD.lowPrice  // $10,000
      );
      await time.increase(3600);

      // Stay within 50% deviation: 1000000 → 1400000 (40% up)
      await oracle.updatePrice(
        CHARIZARD.productId, CHARIZARD.categoryId, CHARIZARD.name,
        1400000, CHARIZARD.lowPrice  // $14,000
      );
      await time.increase(3600);

      // Stay within 50% of 1400000: → 1100000 (~21% down)
      await oracle.updatePrice(
        CHARIZARD.productId, CHARIZARD.categoryId, CHARIZARD.name,
        1100000, CHARIZARD.lowPrice  // $11,000
      );

      // TWAP over 3 periods: (1000000 + 1400000 + 1100000) / 3 = 1166666
      const twap3 = await oracle.getTWAP(CHARIZARD.productId, 3);
      expect(twap3).to.equal(1166666n);

      // TWAP over 2 periods: (1400000 + 1100000) / 2 = 1250000
      const twap2 = await oracle.getTWAP(CHARIZARD.productId, 2);
      expect(twap2).to.equal(1250000n);

      // TWAP over 1 period: latest = 1100000
      const twap1 = await oracle.getTWAP(CHARIZARD.productId, 1);
      expect(twap1).to.equal(1100000n);
    });

    it("should wrap around the ring buffer correctly", async function () {
      // Register product with a base price
      await oracle.updatePrice(
        CHARIZARD.productId, CHARIZARD.categoryId, CHARIZARD.name,
        100000, CHARIZARD.lowPrice  // $1,000.00
      );

      // Fill ring buffer with small increments (within 50% deviation)
      // Each step increases by ~2%, well within bounds
      let price = 100000;
      for (let i = 1; i <= 25; i++) {
        await time.increase(3600);
        price += 2000; // +$20 per step (2% of base)
        await oracle.updatePrice(
          CHARIZARD.productId, CHARIZARD.categoryId, CHARIZARD.name,
          price, CHARIZARD.lowPrice
        );
      }

      // The ring should now have wrapped around
      // TWAP of last 1 should be the most recent price
      const twap1 = await oracle.getTWAP(CHARIZARD.productId, 1);
      expect(twap1).to.equal(BigInt(price));

      // TWAP of last 24 should be an average
      const twap24 = await oracle.getTWAP(CHARIZARD.productId, 24);
      expect(twap24).to.be.gt(0n);
    });

    it("should revert for invalid period count", async function () {
      await oracle.updatePrice(
        CHARIZARD.productId, CHARIZARD.categoryId, CHARIZARD.name,
        CHARIZARD.marketPrice, CHARIZARD.lowPrice
      );

      await expect(
        oracle.getTWAP(CHARIZARD.productId, 0)
      ).to.be.revertedWith("Periods must be 1-24");

      await expect(
        oracle.getTWAP(CHARIZARD.productId, 25)
      ).to.be.revertedWith("Periods must be 1-24");
    });

    it("should revert for non-existent product", async function () {
      await expect(
        oracle.getTWAP(999999, 1)
      ).to.be.revertedWith("Product not found");
    });

    it("should store observations from batchUpdatePricesOnly", async function () {
      // Register first
      await oracle.updatePrice(
        CHARIZARD.productId, CHARIZARD.categoryId, CHARIZARD.name,
        1000000, CHARIZARD.lowPrice
      );
      await time.increase(3600);

      // Batch update (within 50% deviation: 1000000 → 1400000 = 40%)
      await oracle.batchUpdatePricesOnly(
        [CHARIZARD.productId],
        [1400000],
        [1200000]
      );

      // TWAP should reflect both observations
      const twap = await oracle.getTWAP(CHARIZARD.productId, 2);
      expect(twap).to.equal(1200000n); // (1000000 + 1400000) / 2
    });
  });

  // ─── Read Functions ─────────────────────────────────────────

  describe("Read Functions", function () {
    beforeEach(async function () {
      await oracle.batchRegister(
        [CHARIZARD.productId, EVOLVING_SKIES.productId, REVISED_BOX.productId],
        [CHARIZARD.categoryId, EVOLVING_SKIES.categoryId, REVISED_BOX.categoryId],
        [CHARIZARD.name, EVOLVING_SKIES.name, REVISED_BOX.name],
        [CHARIZARD.marketPrice, EVOLVING_SKIES.marketPrice, REVISED_BOX.marketPrice],
        [CHARIZARD.lowPrice, EVOLVING_SKIES.lowPrice, REVISED_BOX.lowPrice]
      );
    });

    it("getProduct should return by index", async function () {
      const p = await oracle.getProduct(0);
      expect(p.productId).to.equal(CHARIZARD.productId);
    });

    it("getProduct should revert for out-of-bounds index", async function () {
      await expect(oracle.getProduct(99)).to.be.revertedWith("Index out of bounds");
    });

    it("getProductById should return by TCGPlayer ID", async function () {
      const p = await oracle.getProductById(REVISED_BOX.productId);
      expect(p.name).to.equal(REVISED_BOX.name);
    });

    it("getProductById should revert for non-existent ID", async function () {
      await expect(oracle.getProductById(999999)).to.be.revertedWith("Product not found");
    });

    it("getAllProducts should return all products", async function () {
      const all = await oracle.getAllProducts();
      expect(all.length).to.equal(3);
      expect(all[0].productId).to.equal(CHARIZARD.productId);
      expect(all[1].productId).to.equal(EVOLVING_SKIES.productId);
      expect(all[2].productId).to.equal(REVISED_BOX.productId);
    });

    it("productExists should return correct values", async function () {
      expect(await oracle.productExists(CHARIZARD.productId)).to.equal(true);
      expect(await oracle.productExists(999999)).to.equal(false);
    });

    it("getPriceHistory should revert for non-existent product", async function () {
      await expect(oracle.getPriceHistory(999999)).to.be.revertedWith("Product not found");
    });
  });

  // ─── Pausable ───────────────────────────────────────────────

  describe("Pausable", function () {
    it("should allow owner to pause", async function () {
      await oracle.pause();
      expect(await oracle.paused()).to.equal(true);
    });

    it("should block updates when paused", async function () {
      await oracle.pause();

      await expect(
        oracle.updatePrice(
          CHARIZARD.productId, CHARIZARD.categoryId, CHARIZARD.name,
          CHARIZARD.marketPrice, CHARIZARD.lowPrice
        )
      ).to.be.revertedWithCustomError(oracle, "EnforcedPause");
    });

    it("should block batch registration when paused", async function () {
      await oracle.pause();

      await expect(
        oracle.batchRegister([1], [2], ["test"], [100], [50])
      ).to.be.revertedWithCustomError(oracle, "EnforcedPause");
    });

    it("should block batch price updates when paused", async function () {
      // Register first, then pause
      await oracle.updatePrice(
        CHARIZARD.productId, CHARIZARD.categoryId, CHARIZARD.name,
        CHARIZARD.marketPrice, CHARIZARD.lowPrice
      );
      await oracle.pause();

      await expect(
        oracle.batchUpdatePricesOnly([CHARIZARD.productId], [1900000], [1800000])
      ).to.be.revertedWithCustomError(oracle, "EnforcedPause");
    });

    it("should still allow reads when paused", async function () {
      await oracle.updatePrice(
        CHARIZARD.productId, CHARIZARD.categoryId, CHARIZARD.name,
        CHARIZARD.marketPrice, CHARIZARD.lowPrice
      );
      await oracle.pause();

      // All read functions should still work
      const [price, , ] = await oracle.getLatestPrice(CHARIZARD.productId);
      expect(price).to.equal(CHARIZARD.marketPrice);

      const p = await oracle.getProduct(0);
      expect(p.productId).to.equal(CHARIZARD.productId);

      const all = await oracle.getAllProducts();
      expect(all.length).to.equal(1);
    });

    it("should allow owner to unpause", async function () {
      await oracle.pause();
      await oracle.unpause();
      expect(await oracle.paused()).to.equal(false);

      // Should be able to update again
      await oracle.updatePrice(
        CHARIZARD.productId, CHARIZARD.categoryId, CHARIZARD.name,
        CHARIZARD.marketPrice, CHARIZARD.lowPrice
      );
      expect(await oracle.productCount()).to.equal(1);
    });

    it("should reject pause from non-owner", async function () {
      await expect(
        oracle.connect(other).pause()
      ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
    });
  });

  // ─── Ownership (Ownable2Step) ───────────────────────────────

  describe("Ownership (Ownable2Step)", function () {
    it("should require 2-step transfer", async function () {
      // Step 1: current owner initiates transfer
      await oracle.transferOwnership(newOwner.address);

      // Owner is still the original owner until accepted
      expect(await oracle.owner()).to.equal(owner.address);
      expect(await oracle.pendingOwner()).to.equal(newOwner.address);
    });

    it("should complete transfer when new owner accepts", async function () {
      await oracle.transferOwnership(newOwner.address);
      await oracle.connect(newOwner).acceptOwnership();

      expect(await oracle.owner()).to.equal(newOwner.address);
      expect(await oracle.pendingOwner()).to.equal(ethers.ZeroAddress);
    });

    it("should reject acceptance from wrong address", async function () {
      await oracle.transferOwnership(newOwner.address);

      await expect(
        oracle.connect(other).acceptOwnership()  // not newOwner
      ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
    });

    it("new owner should be able to update prices", async function () {
      await oracle.transferOwnership(newOwner.address);
      await oracle.connect(newOwner).acceptOwnership();

      await oracle.connect(newOwner).updatePrice(
        CHARIZARD.productId, CHARIZARD.categoryId, CHARIZARD.name,
        CHARIZARD.marketPrice, CHARIZARD.lowPrice
      );
      expect(await oracle.productCount()).to.equal(1);
    });

    it("old owner should NOT be able to update after transfer", async function () {
      await oracle.transferOwnership(newOwner.address);
      await oracle.connect(newOwner).acceptOwnership();

      await expect(
        oracle.connect(owner).updatePrice(
          CHARIZARD.productId, CHARIZARD.categoryId, CHARIZARD.name,
          CHARIZARD.marketPrice, CHARIZARD.lowPrice
        )
      ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────────

  describe("Edge Cases", function () {
    it("should handle product at index 0 correctly (V1 bug fix)", async function () {
      // V1 had a bug where productIndex default value (0) collided with
      // the first product at index 0. V2 uses explicit productExists mapping.
      await oracle.updatePrice(100, 3, "First Product", 500, 400);
      await oracle.updatePrice(200, 2, "Second Product", 600, 500);

      // Check both exist independently
      expect(await oracle.productExists(100)).to.equal(true);
      expect(await oracle.productExists(200)).to.equal(true);

      const p1 = await oracle.getProductById(100);
      expect(p1.name).to.equal("First Product");

      const p2 = await oracle.getProductById(200);
      expect(p2.name).to.equal("Second Product");
    });

    it("should handle empty batch gracefully", async function () {
      await oracle.batchRegister([], [], [], [], []);
      expect(await oracle.productCount()).to.equal(0);
    });

    it("should handle zero prices", async function () {
      await oracle.updatePrice(100, 3, "Free Product", 0, 0);
      const p = await oracle.getProductById(100);
      expect(p.marketPrice).to.equal(0);
    });

    it("should handle very large prices", async function () {
      const bigPrice = ethers.parseUnits("100000000", 0); // $1,000,000.00 in cents
      await oracle.updatePrice(100, 3, "Expensive Card", bigPrice, bigPrice);
      const p = await oracle.getProductById(100);
      expect(p.marketPrice).to.equal(bigPrice);
    });

    it("should handle long product names", async function () {
      const longName = "A".repeat(200);
      await oracle.updatePrice(100, 3, longName, 500, 400);
      const p = await oracle.getProductById(100);
      expect(p.name).to.equal(longName);
    });

    it("should handle rapid updates to same product", async function () {
      // Start with a base price
      await oracle.updatePrice(100, 3, "Volatile Card", 10000, 50);
      
      // Update with small increments within 50% deviation
      for (let i = 1; i < 30; i++) {
        const newPrice = 10000 + (i * 100); // +$1 per update
        await oracle.updatePrice(100, 3, "Volatile Card", newPrice, 50);
      }
      expect(await oracle.productCount()).to.equal(1);
      expect(await oracle.totalUpdates()).to.equal(30);

      const p = await oracle.getProductById(100);
      expect(p.marketPrice).to.equal(12900); // 10000 + 29*100
    });

    it("should reject price deviation > 50%", async function () {
      // Register with a price of $10,000
      await oracle.updatePrice(100, 3, "Card", 1000000, 500000);

      // Try to update to $20,000 (100% increase) — should revert
      await expect(
        oracle.updatePrice(100, 3, "Card", 2000000, 1500000)
      ).to.be.revertedWith("Price deviation too large");

      // Update to $14,000 (40% increase) — should succeed
      await oracle.updatePrice(100, 3, "Card", 1400000, 1000000);
      const p = await oracle.getProductById(100);
      expect(p.marketPrice).to.equal(1400000);
    });

    it("should block renounceOwnership", async function () {
      await expect(
        oracle.renounceOwnership()
      ).to.be.revertedWith("Cannot renounce ownership");
    });

    it("getLatestPriceStrict should revert on stale data", async function () {
      await oracle.updatePrice(
        CHARIZARD.productId, CHARIZARD.categoryId, CHARIZARD.name,
        CHARIZARD.marketPrice, CHARIZARD.lowPrice
      );

      // Should work immediately
      const [price, timestamp] = await oracle.getLatestPriceStrict(CHARIZARD.productId);
      expect(price).to.equal(CHARIZARD.marketPrice);

      // Fast-forward past staleness threshold
      await time.increase(3 * 60 * 60);

      // Should revert now
      await expect(
        oracle.getLatestPriceStrict(CHARIZARD.productId)
      ).to.be.revertedWith("Price is stale");
    });
  });

  // ─── Gas Report Scenario ────────────────────────────────────

  describe("Realistic 50-Product Scenario", function () {
    it("should register and update 50 products", async function () {
      // Register 50 products (simulates initial setup)
      const ids = Array.from({ length: 50 }, (_, i) => i + 1000);
      const cats = Array(50).fill(3);
      const names = Array.from({ length: 50 }, (_, i) => `Product #${i + 1}`);
      const prices = Array.from({ length: 50 }, (_, i) => (i + 1) * 100000);
      const lows = Array.from({ length: 50 }, (_, i) => (i + 1) * 80000);

      await oracle.batchRegister(ids, cats, names, prices, lows);
      expect(await oracle.productCount()).to.equal(50);

      // Hourly price-only update (simulates cron job)
      const newPrices = prices.map(p => p + 1000);
      const newLows = lows.map(l => l + 800);

      await oracle.batchUpdatePricesOnly(ids, newPrices, newLows);
      expect(await oracle.totalUpdates()).to.equal(100); // 50 register + 50 update

      // Verify TWAP works after 2 observations
      const twap = await oracle.getTWAP(1000, 2);
      expect(twap).to.be.gt(0);
    });
  });
});
