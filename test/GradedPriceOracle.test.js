const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("GradedPriceOracle", function () {
  let oracle;
  let owner, other, verifier;

  // Sample graded products (matching leaf encoding: productId, grade, gradingCompany, medianPrice, numListings)
  const PRODUCTS = [
    { productId: 98580,  grade: "PSA 10", gradingCompany: "PSA", medianPrice: 4250000,  numListings: 42 },
    { productId: 98580,  grade: "PSA 9",  gradingCompany: "PSA", medianPrice: 1875000,  numListings: 78 },
    { productId: 248124, grade: "PSA 10", gradingCompany: "PSA", medianPrice: 350000,   numListings: 15 },
    { productId: 1196,   grade: "BGS 9.5",gradingCompany: "BGS", medianPrice: 445300,   numListings: 8  },
    { productId: 506640, grade: "SGC 10", gradingCompany: "SGC", medianPrice: 125000,   numListings: 23 },
  ];

  /**
   * Build a Merkle tree from graded product data.
   * Uses OpenZeppelin's double-hash standard:
   *   leaf = keccak256(bytes.concat(keccak256(abi.encode(productId, grade, gradingCompany, medianPrice, numListings))))
   */
  function computeLeaf(product) {
    const innerHash = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "string", "string", "uint256", "uint256"],
      [product.productId, product.grade, product.gradingCompany, product.medianPrice, product.numListings]
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
    const Factory = await ethers.getContractFactory("GradedPriceOracle");
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

    it("should start with zero graded products", async function () {
      expect(await oracle.totalGradedProducts()).to.equal(0);
    });

    it("should have 48-hour staleness threshold", async function () {
      expect(await oracle.ROOT_STALENESS_THRESHOLD()).to.equal(48 * 60 * 60);
    });

    it("should not be paused", async function () {
      expect(await oracle.paused()).to.equal(false);
    });
  });

  // ─── Root Updates ───────────────────────────────────────

  describe("updateMerkleRoot", function () {
    it("should update the root", async function () {
      const { root } = buildMerkleTree(PRODUCTS);
      await oracle.updateMerkleRoot(root, PRODUCTS.length);

      expect(await oracle.merkleRoot()).to.equal(root);
      expect(await oracle.totalGradedProducts()).to.equal(PRODUCTS.length);
      expect(await oracle.totalRootUpdates()).to.equal(1);
    });

    it("should update lastRootUpdate timestamp", async function () {
      const { root } = buildMerkleTree(PRODUCTS);
      const tx = await oracle.updateMerkleRoot(root, PRODUCTS.length);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      expect(await oracle.lastRootUpdate()).to.equal(block.timestamp);
    });

    it("should emit GradedRootUpdated event", async function () {
      const { root } = buildMerkleTree(PRODUCTS);
      await expect(oracle.updateMerkleRoot(root, PRODUCTS.length))
        .to.emit(oracle, "GradedRootUpdated");
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

    it("should store root timestamps in history", async function () {
      const { root } = buildMerkleTree(PRODUCTS);
      const tx = await oracle.updateMerkleRoot(root, PRODUCTS.length);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      const [, storedTimestamp] = await oracle.getRootAtIndex(0);
      expect(storedTimestamp).to.equal(block.timestamp);
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

    it("should allow updating the root multiple times", async function () {
      const { root: root1 } = buildMerkleTree(PRODUCTS);
      await oracle.updateMerkleRoot(root1, 5);

      const { root: root2 } = buildMerkleTree(PRODUCTS.slice(0, 2));
      await oracle.updateMerkleRoot(root2, 2);

      expect(await oracle.merkleRoot()).to.equal(root2);
      expect(await oracle.totalGradedProducts()).to.equal(2);
      expect(await oracle.totalRootUpdates()).to.equal(2);
    });
  });

  // ─── Verification ───────────────────────────────────────

  describe("verifyGradedPrice", function () {
    let merkle;

    beforeEach(async function () {
      merkle = buildMerkleTree(PRODUCTS);
      await oracle.updateMerkleRoot(merkle.root, PRODUCTS.length);
    });

    it("should verify a valid graded price", async function () {
      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);

      const valid = await oracle.verifyGradedPrice(
        product.productId,
        product.grade,
        product.gradingCompany,
        product.medianPrice,
        product.numListings,
        proof
      );

      expect(valid).to.equal(true);
    });

    it("should verify each product in the tree", async function () {
      for (let i = 0; i < PRODUCTS.length; i++) {
        const product = PRODUCTS[i];
        const proof = getProof(merkle.tree, i);

        const valid = await oracle.verifyGradedPrice(
          product.productId,
          product.grade,
          product.gradingCompany,
          product.medianPrice,
          product.numListings,
          proof
        );

        expect(valid).to.equal(true);
      }
    });

    it("should reject wrong median price", async function () {
      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);

      const valid = await oracle.verifyGradedPrice(
        product.productId,
        product.grade,
        product.gradingCompany,
        9999999, // wrong price
        product.numListings,
        proof
      );

      expect(valid).to.equal(false);
    });

    it("should reject wrong product ID", async function () {
      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);

      const valid = await oracle.verifyGradedPrice(
        999999, // wrong ID
        product.grade,
        product.gradingCompany,
        product.medianPrice,
        product.numListings,
        proof
      );

      expect(valid).to.equal(false);
    });

    it("should reject wrong grade", async function () {
      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);

      const valid = await oracle.verifyGradedPrice(
        product.productId,
        "PSA 1", // wrong grade
        product.gradingCompany,
        product.medianPrice,
        product.numListings,
        proof
      );

      expect(valid).to.equal(false);
    });

    it("should reject wrong grading company", async function () {
      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);

      const valid = await oracle.verifyGradedPrice(
        product.productId,
        product.grade,
        "FAKE_COMPANY", // wrong company
        product.medianPrice,
        product.numListings,
        proof
      );

      expect(valid).to.equal(false);
    });

    it("should reject wrong numListings", async function () {
      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);

      const valid = await oracle.verifyGradedPrice(
        product.productId,
        product.grade,
        product.gradingCompany,
        product.medianPrice,
        0, // wrong listings count
        proof
      );

      expect(valid).to.equal(false);
    });

    it("should reject wrong proof", async function () {
      const product = PRODUCTS[0];
      const wrongProof = getProof(merkle.tree, 3); // proof for different product

      const valid = await oracle.verifyGradedPrice(
        product.productId,
        product.grade,
        product.gradingCompany,
        product.medianPrice,
        product.numListings,
        wrongProof
      );

      expect(valid).to.equal(false);
    });

    it("should revert when no root is set", async function () {
      const Factory = await ethers.getContractFactory("GradedPriceOracle");
      const freshOracle = await Factory.deploy();

      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);

      await expect(
        freshOracle.verifyGradedPrice(
          product.productId, product.grade, product.gradingCompany,
          product.medianPrice, product.numListings, proof
        )
      ).to.be.revertedWith("No root set");
    });

    it("should allow anyone to verify (no access control)", async function () {
      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);

      const valid = await oracle.connect(other).verifyGradedPrice(
        product.productId, product.grade, product.gradingCompany,
        product.medianPrice, product.numListings, proof
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

    it("should emit GradedPriceVerified event", async function () {
      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);

      await expect(
        oracle.connect(verifier).verifyAndRecord(
          product.productId, product.grade, product.gradingCompany,
          product.medianPrice, product.numListings, proof
        )
      )
        .to.emit(oracle, "GradedPriceVerified")
        .withArgs(product.productId, product.grade, product.medianPrice, verifier.address);
    });

    it("should revert on invalid proof", async function () {
      const product = PRODUCTS[0];
      const wrongProof = getProof(merkle.tree, 3);

      await expect(
        oracle.connect(verifier).verifyAndRecord(
          product.productId, product.grade, product.gradingCompany,
          product.medianPrice, product.numListings, wrongProof
        )
      ).to.be.revertedWith("Invalid proof");
    });

    it("should revert when no root is set", async function () {
      const Factory = await ethers.getContractFactory("GradedPriceOracle");
      const freshOracle = await Factory.deploy();

      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);

      await expect(
        freshOracle.verifyAndRecord(
          product.productId, product.grade, product.gradingCompany,
          product.medianPrice, product.numListings, proof
        )
      ).to.be.revertedWith("No root set");
    });

    it("should return true for valid proof", async function () {
      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);

      const result = await oracle.verifyAndRecord.staticCall(
        product.productId, product.grade, product.gradingCompany,
        product.medianPrice, product.numListings, proof
      );

      expect(result).to.equal(true);
    });
  });

  // ─── computeLeaf ───────────────────────────────────────

  describe("computeLeaf", function () {
    it("should match off-chain leaf computation", async function () {
      const product = PRODUCTS[0];
      const offChainLeaf = computeLeaf(product);

      const onChainLeaf = await oracle.computeLeaf(
        product.productId,
        product.grade,
        product.gradingCompany,
        product.medianPrice,
        product.numListings
      );

      expect(onChainLeaf).to.equal(offChainLeaf);
    });

    it("should produce different leaves for different products", async function () {
      const leaf1 = await oracle.computeLeaf(
        PRODUCTS[0].productId, PRODUCTS[0].grade, PRODUCTS[0].gradingCompany,
        PRODUCTS[0].medianPrice, PRODUCTS[0].numListings
      );
      const leaf2 = await oracle.computeLeaf(
        PRODUCTS[1].productId, PRODUCTS[1].grade, PRODUCTS[1].gradingCompany,
        PRODUCTS[1].medianPrice, PRODUCTS[1].numListings
      );

      expect(leaf1).to.not.equal(leaf2);
    });

    it("should produce different leaves for same product different grade", async function () {
      // PRODUCTS[0] and PRODUCTS[1] are the same productId but different grades
      const leaf1 = await oracle.computeLeaf(
        PRODUCTS[0].productId, PRODUCTS[0].grade, PRODUCTS[0].gradingCompany,
        PRODUCTS[0].medianPrice, PRODUCTS[0].numListings
      );
      const leaf2 = await oracle.computeLeaf(
        PRODUCTS[1].productId, PRODUCTS[1].grade, PRODUCTS[1].gradingCompany,
        PRODUCTS[1].medianPrice, PRODUCTS[1].numListings
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

    it("should return true at exactly 48 hours", async function () {
      const { root } = buildMerkleTree(PRODUCTS);
      await oracle.updateMerkleRoot(root, 5);

      await time.increase(48 * 60 * 60); // exactly 48 hours
      expect(await oracle.isRootFresh()).to.equal(true);
    });

    it("should return false after 48 hours", async function () {
      const { root } = buildMerkleTree(PRODUCTS);
      await oracle.updateMerkleRoot(root, 5);

      await time.increase(49 * 60 * 60); // 49 hours
      expect(await oracle.isRootFresh()).to.equal(false);
    });

    it("should become fresh again after a new update", async function () {
      const { root: root1 } = buildMerkleTree(PRODUCTS);
      await oracle.updateMerkleRoot(root1, 5);

      await time.increase(49 * 60 * 60); // stale
      expect(await oracle.isRootFresh()).to.equal(false);

      // Update again
      const { root: root2 } = buildMerkleTree(PRODUCTS.slice(0, 3));
      await oracle.updateMerkleRoot(root2, 3);
      expect(await oracle.isRootFresh()).to.equal(true);
    });
  });

  // ─── getRootAtIndex ─────────────────────────────────────

  describe("getRootAtIndex", function () {
    it("should revert for out-of-bounds index", async function () {
      await expect(
        oracle.getRootAtIndex(0)
      ).to.be.revertedWith("Index out of bounds");
    });

    it("should revert for index beyond total updates", async function () {
      const { root } = buildMerkleTree(PRODUCTS);
      await oracle.updateMerkleRoot(root, 5);

      await expect(
        oracle.getRootAtIndex(1)
      ).to.be.revertedWith("Index out of bounds");
    });

    it("should return correct root and timestamp", async function () {
      const { root } = buildMerkleTree(PRODUCTS);
      const tx = await oracle.updateMerkleRoot(root, 5);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      const [storedRoot, storedTimestamp] = await oracle.getRootAtIndex(0);
      expect(storedRoot).to.equal(root);
      expect(storedTimestamp).to.equal(block.timestamp);
    });
  });

  // ─── Pausable ───────────────────────────────────────────

  describe("Pausable", function () {
    it("should allow owner to pause", async function () {
      await oracle.pause();
      expect(await oracle.paused()).to.equal(true);
    });

    it("should allow owner to unpause", async function () {
      await oracle.pause();
      await oracle.unpause();
      expect(await oracle.paused()).to.equal(false);
    });

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
      expect(await oracle.totalGradedProducts()).to.equal(5);
    });

    it("should allow verification when paused", async function () {
      const merkle = buildMerkleTree(PRODUCTS);
      await oracle.updateMerkleRoot(merkle.root, PRODUCTS.length);
      await oracle.pause();

      const product = PRODUCTS[0];
      const proof = getProof(merkle.tree, 0);
      const valid = await oracle.verifyGradedPrice(
        product.productId, product.grade, product.gradingCompany,
        product.medianPrice, product.numListings, proof
      );
      expect(valid).to.equal(true);
    });

    it("should reject pause from non-owner", async function () {
      await expect(
        oracle.connect(other).pause()
      ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
    });

    it("should reject unpause from non-owner", async function () {
      await oracle.pause();
      await expect(
        oracle.connect(other).unpause()
      ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
    });

    it("should allow updates after unpause", async function () {
      await oracle.pause();
      await oracle.unpause();

      const { root } = buildMerkleTree(PRODUCTS);
      await oracle.updateMerkleRoot(root, 5);
      expect(await oracle.merkleRoot()).to.equal(root);
    });
  });

  // ─── Ownership (Ownable2Step) ───────────────────────────

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
      expect(await oracle.pendingOwner()).to.equal(ethers.ZeroAddress);
    });

    it("should reject acceptance from wrong address", async function () {
      await oracle.transferOwnership(other.address);
      await expect(
        oracle.connect(verifier).acceptOwnership()
      ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
    });

    it("new owner should be able to update root", async function () {
      await oracle.transferOwnership(other.address);
      await oracle.connect(other).acceptOwnership();

      const { root } = buildMerkleTree(PRODUCTS);
      await oracle.connect(other).updateMerkleRoot(root, 5);
      expect(await oracle.merkleRoot()).to.equal(root);
    });

    it("old owner should NOT be able to update after transfer", async function () {
      await oracle.transferOwnership(other.address);
      await oracle.connect(other).acceptOwnership();

      const { root } = buildMerkleTree(PRODUCTS);
      await expect(
        oracle.connect(owner).updateMerkleRoot(root, 5)
      ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
    });

    it("should block renounceOwnership", async function () {
      await expect(
        oracle.renounceOwnership()
      ).to.be.revertedWith("Cannot renounce ownership");
    });
  });

  // ─── Scale Test ─────────────────────────────────────────

  describe("Scale (100 graded products)", function () {
    it("should verify any product in a 100-product tree", async function () {
      // Generate 100 mock graded products
      const bigProducts = Array.from({ length: 100 }, (_, i) => ({
        productId: 10000 + i,
        grade: `PSA ${(i % 10) + 1}`,
        gradingCompany: i % 3 === 0 ? "BGS" : "PSA",
        medianPrice: (i + 1) * 10000,
        numListings: (i % 50) + 1,
      }));

      const merkle = buildMerkleTree(bigProducts);
      await oracle.updateMerkleRoot(merkle.root, bigProducts.length);

      // Verify first, middle, and last
      for (const idx of [0, 49, 99]) {
        const product = bigProducts[idx];
        const proof = getProof(merkle.tree, idx);

        const valid = await oracle.verifyGradedPrice(
          product.productId, product.grade, product.gradingCompany,
          product.medianPrice, product.numListings, proof
        );

        expect(valid).to.equal(true);
      }
    });
  });
});
