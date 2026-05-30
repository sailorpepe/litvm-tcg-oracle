const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("MerklePriceOracle", function () {
  let oracle;
  let owner, other, verifier;

  // Sample products (matching SQLite schema)
  const PRODUCTS = [
    { productId: 98580, categoryId: 3, name: "Pokemon Base Set (Shadowless) [1st Edition] Booster Pack", marketPrice: 1875000, lowPrice: 1750000 },
    { productId: 248124, categoryId: 3, name: "Evolving Skies Booster Box Case", marketPrice: 1484715, lowPrice: 2000000 },
    { productId: 618895, categoryId: 2, name: "Revised Edition - Booster Box", marketPrice: 2650000, lowPrice: 2300000 },
    { productId: 1196, categoryId: 2, name: "Black Lotus [Unlimited]", marketPrice: 445300, lowPrice: 350000 },
    { productId: 506640, categoryId: 62, name: "One Piece Romance Dawn Booster Box", marketPrice: 498110, lowPrice: 582500 },
  ];

  /**
   * Build a Merkle tree from product data.
   * Uses OpenZeppelin's double-hash standard:
   *   leaf = keccak256(bytes.concat(keccak256(abi.encode(productId, categoryId, name, marketPrice, lowPrice))))
   */
  function computeLeaf(product) {
    const innerHash = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint16", "string", "uint256", "uint256"],
      [product.productId, product.categoryId, product.name, product.marketPrice, product.lowPrice]
    );
    return ethers.keccak256(
      ethers.solidityPacked(["bytes32"], [ethers.keccak256(innerHash)])
    );
  }

  function buildMerkleTree(products) {
    // Compute leaves
    let leaves = products.map(computeLeaf);

    // Pad to power of 2
    while (leaves.length & (leaves.length - 1)) {
      leaves.push(ethers.ZeroHash);
    }
    if (leaves.length === 0) leaves = [ethers.ZeroHash, ethers.ZeroHash];
    if (leaves.length === 1) leaves.push(ethers.ZeroHash);

    // Build tree bottom-up
    const tree = [leaves.slice()];
    let current = leaves.slice();

    while (current.length > 1) {
      const next = [];
      for (let i = 0; i < current.length; i += 2) {
        const left = current[i];
        const right = current[i + 1] || ethers.ZeroHash;
        // Sort pair (OpenZeppelin standard)
        const pair = left < right ? [left, right] : [right, left];
        next.push(ethers.keccak256(ethers.solidityPacked(["bytes32", "bytes32"], pair)));
      }
      tree.push(next);
      current = next;
    }

    return { root: current[0], tree, leaves: tree[0] };
  }

  function getProof(tree, leafIndex) {
    const proof = [];
    let idx = leafIndex;

    for (let level = 0; level < tree.length - 1; level++) {
      const layer = tree[level];
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      if (siblingIdx < layer.length) {
        proof.push(layer[siblingIdx]);
      } else {
        proof.push(ethers.ZeroHash);
      }
      idx = Math.floor(idx / 2);
    }

    return proof;
  }

  beforeEach(async function () {
    [owner, other, verifier] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("MerklePriceOracle");
    oracle = await Factory.deploy();
    await oracle.waitForDeployment();
  });

  // ─── Deployment ─────────────────────────────────────────

  describe("Deployment", function () {
    it("should set deployer as owner", async function () {
      expect(await oracle.owner()).to.equal(owner.address);
    });

    it("should start with no root", async function () {
      expect(await oracle.merkleRoot()).to.equal(ethers.ZeroHash);
    });

    it("should start with zero updates", async function () {
      expect(await oracle.totalRootUpdates()).to.equal(0);
    });

    it("should have 48-hour staleness threshold", async function () {
      expect(await oracle.ROOT_STALENESS_THRESHOLD()).to.equal(48 * 60 * 60);
    });
  });

  // ─── Root Updates ───────────────────────────────────────

  describe("updateMerkleRoot", function () {
    it("should update the root", async function () {
      const { root } = buildMerkleTree(PRODUCTS);
      await oracle.updateMerkleRoot(root, PRODUCTS.length);

      expect(await oracle.merkleRoot()).to.equal(root);
      expect(await oracle.totalProducts()).to.equal(PRODUCTS.length);
      expect(await oracle.totalRootUpdates()).to.equal(1);
    });

    it("should emit MerkleRootUpdated event", async function () {
      const { root } = buildMerkleTree(PRODUCTS);
      await expect(oracle.updateMerkleRoot(root, PRODUCTS.length))
        .to.emit(oracle, "MerkleRootUpdated");
    });

    it("should store root history", async function () {
      const { root: root1 } = buildMerkleTree(PRODUCTS);
      await oracle.updateMerkleRoot(root1, 5);

      const { root: root2 } = buildMerkleTree(PRODUCTS.slice(0, 3));
      await oracle.updateMerkleRoot(root2, 3);

      const [storedRoot1] = await oracle.getRootAtIndex(0);
      const [storedRoot2] = await oracle.getRootAtIndex(1);

      expect(storedRoot1).to.equal(root1);
      expect(storedRoot2).to.equal(root2);
      expect(await oracle.totalRootUpdates()).to.equal(2);
    });

    it("should reject zero root", async function () {
      await expect(
        oracle.updateMerkleRoot(ethers.ZeroHash, 5)
      ).to.be.revertedWith("Root cannot be zero");
    });

    it("should reject zero products", async function () {
      const { root } = buildMerkleTree(PRODUCTS);
      await expect(
        oracle.updateMerkleRoot(root, 0)
      ).to.be.revertedWith("Must have products");
    });

    it("should reject non-owner", async function () {
      const { root } = buildMerkleTree(PRODUCTS);
      await expect(
        oracle.connect(other).updateMerkleRoot(root, 5)
      ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
    });
  });

  // ─── Verification ───────────────────────────────────────

  describe("verifyPrice", function () {
    let merkle;

    beforeEach(async function () {
      merkle = buildMerkleTree(PRODUCTS);
      await oracle.updateMerkleRoot(merkle.root, PRODUCTS.length);
    });

    it("should verify a valid price", async function () {
      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);

      const valid = await oracle.verifyPrice(
        product.productId,
        product.categoryId,
        product.name,
        product.marketPrice,
        product.lowPrice,
        proof
      );

      expect(valid).to.equal(true);
    });

    it("should verify each product in the tree", async function () {
      for (let i = 0; i < PRODUCTS.length; i++) {
        const product = PRODUCTS[i];
        const proof = getProof(merkle.tree, i);

        const valid = await oracle.verifyPrice(
          product.productId,
          product.categoryId,
          product.name,
          product.marketPrice,
          product.lowPrice,
          proof
        );

        expect(valid).to.equal(true);
      }
    });

    it("should reject wrong price", async function () {
      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);

      const valid = await oracle.verifyPrice(
        product.productId,
        product.categoryId,
        product.name,
        9999999, // wrong price
        product.lowPrice,
        proof
      );

      expect(valid).to.equal(false);
    });

    it("should reject wrong product ID", async function () {
      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);

      const valid = await oracle.verifyPrice(
        999999, // wrong ID
        product.categoryId,
        product.name,
        product.marketPrice,
        product.lowPrice,
        proof
      );

      expect(valid).to.equal(false);
    });

    it("should reject wrong name", async function () {
      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);

      const valid = await oracle.verifyPrice(
        product.productId,
        product.categoryId,
        "FAKE NAME",
        product.marketPrice,
        product.lowPrice,
        proof
      );

      expect(valid).to.equal(false);
    });

    it("should reject wrong proof", async function () {
      const product = PRODUCTS[0];
      const wrongProof = getProof(merkle.tree, 2); // proof for different product

      const valid = await oracle.verifyPrice(
        product.productId,
        product.categoryId,
        product.name,
        product.marketPrice,
        product.lowPrice,
        wrongProof
      );

      expect(valid).to.equal(false);
    });

    it("should revert when no root is set", async function () {
      const Factory = await ethers.getContractFactory("MerklePriceOracle");
      const freshOracle = await Factory.deploy();

      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);

      await expect(
        freshOracle.verifyPrice(
          product.productId, product.categoryId, product.name,
          product.marketPrice, product.lowPrice, proof
        )
      ).to.be.revertedWith("No root set");
    });

    it("should allow anyone to verify (no access control)", async function () {
      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);

      const valid = await oracle.connect(other).verifyPrice(
        product.productId, product.categoryId, product.name,
        product.marketPrice, product.lowPrice, proof
      );

      expect(valid).to.equal(true);
    });
  });

  // ─── Verify and Record ─────────────────────────────────

  describe("verifyAndRecord", function () {
    let merkle;

    beforeEach(async function () {
      merkle = buildMerkleTree(PRODUCTS);
      await oracle.updateMerkleRoot(merkle.root, PRODUCTS.length);
    });

    it("should emit PriceVerified event", async function () {
      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);

      await expect(
        oracle.connect(verifier).verifyAndRecord(
          product.productId, product.categoryId, product.name,
          product.marketPrice, product.lowPrice, proof
        )
      )
        .to.emit(oracle, "PriceVerified")
        .withArgs(product.productId, product.marketPrice, verifier.address);
    });

    it("should revert on invalid proof", async function () {
      const product = PRODUCTS[0];
      const wrongProof = getProof(merkle.tree, 3);

      await expect(
        oracle.connect(verifier).verifyAndRecord(
          product.productId, product.categoryId, product.name,
          product.marketPrice, product.lowPrice, wrongProof
        )
      ).to.be.revertedWith("Invalid proof");
    });
  });

  // ─── computeLeaf ───────────────────────────────────────

  describe("computeLeaf", function () {
    it("should match off-chain leaf computation", async function () {
      const product = PRODUCTS[0];
      const offChainLeaf = computeLeaf(product);

      const onChainLeaf = await oracle.computeLeaf(
        product.productId,
        product.categoryId,
        product.name,
        product.marketPrice,
        product.lowPrice
      );

      expect(onChainLeaf).to.equal(offChainLeaf);
    });

    it("should produce different leaves for different products", async function () {
      const leaf1 = await oracle.computeLeaf(
        PRODUCTS[0].productId, PRODUCTS[0].categoryId, PRODUCTS[0].name,
        PRODUCTS[0].marketPrice, PRODUCTS[0].lowPrice
      );
      const leaf2 = await oracle.computeLeaf(
        PRODUCTS[1].productId, PRODUCTS[1].categoryId, PRODUCTS[1].name,
        PRODUCTS[1].marketPrice, PRODUCTS[1].lowPrice
      );

      expect(leaf1).to.not.equal(leaf2);
    });
  });

  // ─── Freshness ──────────────────────────────────────────

  describe("isRootFresh", function () {
    it("should return false when no root set", async function () {
      expect(await oracle.isRootFresh()).to.equal(false);
    });

    it("should return true after update", async function () {
      const { root } = buildMerkleTree(PRODUCTS);
      await oracle.updateMerkleRoot(root, 5);
      expect(await oracle.isRootFresh()).to.equal(true);
    });

    it("should return false after 48 hours", async function () {
      const { root } = buildMerkleTree(PRODUCTS);
      await oracle.updateMerkleRoot(root, 5);

      await time.increase(49 * 60 * 60); // 49 hours
      expect(await oracle.isRootFresh()).to.equal(false);
    });
  });

  // ─── Pausable ───────────────────────────────────────────

  describe("Pausable", function () {
    it("should block root updates when paused", async function () {
      await oracle.pause();
      const { root } = buildMerkleTree(PRODUCTS);
      await expect(
        oracle.updateMerkleRoot(root, 5)
      ).to.be.revertedWithCustomError(oracle, "EnforcedPause");
    });

    it("should allow reads when paused", async function () {
      const { root } = buildMerkleTree(PRODUCTS);
      await oracle.updateMerkleRoot(root, 5);
      await oracle.pause();

      expect(await oracle.merkleRoot()).to.equal(root);
      expect(await oracle.isRootFresh()).to.equal(true);
    });

    it("should allow verification when paused", async function () {
      const merkle = buildMerkleTree(PRODUCTS);
      await oracle.updateMerkleRoot(merkle.root, PRODUCTS.length);
      await oracle.pause();

      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);
      const valid = await oracle.verifyPrice(
        product.productId, product.categoryId, product.name,
        product.marketPrice, product.lowPrice, proof
      );
      expect(valid).to.equal(true);
    });
  });

  // ─── Ownership ──────────────────────────────────────────

  describe("Ownership (Ownable2Step)", function () {
    it("should require 2-step transfer", async function () {
      await oracle.transferOwnership(other.address);
      expect(await oracle.owner()).to.equal(owner.address);
      expect(await oracle.pendingOwner()).to.equal(other.address);
    });

    it("should complete on acceptance", async function () {
      await oracle.transferOwnership(other.address);
      await oracle.connect(other).acceptOwnership();
      expect(await oracle.owner()).to.equal(other.address);
    });
  });

  // ─── Scale Test ─────────────────────────────────────────

  describe("Scale (100 products)", function () {
    it("should verify any product in a 100-product tree", async function () {
      // Generate 100 mock products
      const bigProducts = Array.from({ length: 100 }, (_, i) => ({
        productId: 10000 + i,
        categoryId: i % 5 === 0 ? 2 : 3,
        name: `Test Product #${i + 1}`,
        marketPrice: (i + 1) * 10000,
        lowPrice: (i + 1) * 8000,
      }));

      const merkle = buildMerkleTree(bigProducts);
      await oracle.updateMerkleRoot(merkle.root, bigProducts.length);

      // Verify first, middle, and last
      for (const idx of [0, 49, 99]) {
        const product = bigProducts[idx];
        const proof = getProof(merkle.tree, idx);

        const valid = await oracle.verifyPrice(
          product.productId, product.categoryId, product.name,
          product.marketPrice, product.lowPrice, proof
        );

        expect(valid).to.equal(true);
      }
    });
  });
});
