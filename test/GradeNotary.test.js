const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GradeNotary", function () {
  let notary;
  let owner, other, third;

  // Sample card data
  const CHARIZARD = {
    cardName: "Charizard Base Set 1st Edition",
    predictedGrade: "PSA 9",
    imageHash: "QmYwAPJzv5CZsnAzt8auVZRnHLC5E3ae2d31aef3b7e1f9",
  };

  const BLACK_LOTUS = {
    cardName: "Black Lotus [Unlimited]",
    predictedGrade: "BGS 9.5",
    imageHash: "QmXk8bDrVc9LTz1abcdef1234567890abcdef12345678",
  };

  const BLUE_EYES = {
    cardName: "Blue-Eyes White Dragon LOB-001",
    predictedGrade: "PSA 10",
    imageHash: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  };

  beforeEach(async function () {
    [owner, other, third] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("GradeNotary");
    notary = await Factory.deploy(owner.address);
    await notary.waitForDeployment();
  });

  // ─── Deployment ─────────────────────────────────────────────

  describe("Deployment", function () {
    it("should set the deployer as owner", async function () {
      expect(await notary.owner()).to.equal(owner.address);
    });

    it("should set correct ERC721 name", async function () {
      expect(await notary.name()).to.equal("TCG Grade Notary");
    });

    it("should set correct ERC721 symbol", async function () {
      expect(await notary.symbol()).to.equal("GRADE");
    });

    it("should allow deploying with a different initial owner", async function () {
      const Factory = await ethers.getContractFactory("GradeNotary");
      const notary2 = await Factory.deploy(other.address);
      await notary2.waitForDeployment();

      expect(await notary2.owner()).to.equal(other.address);
    });
  });

  // ─── notarizeGrade ──────────────────────────────────────────

  describe("notarizeGrade", function () {
    it("should mint a certificate to the caller", async function () {
      await notary.notarizeGrade(
        CHARIZARD.cardName,
        CHARIZARD.predictedGrade,
        CHARIZARD.imageHash
      );

      // Token 0 should be owned by the caller (owner)
      expect(await notary.ownerOf(0)).to.equal(owner.address);
      expect(await notary.balanceOf(owner.address)).to.equal(1);
    });

    it("should allow anyone to notarize (no access control on minting)", async function () {
      await notary.connect(other).notarizeGrade(
        CHARIZARD.cardName,
        CHARIZARD.predictedGrade,
        CHARIZARD.imageHash
      );

      expect(await notary.ownerOf(0)).to.equal(other.address);
    });

    it("should emit CertificateNotarized event", async function () {
      await expect(
        notary.notarizeGrade(
          CHARIZARD.cardName,
          CHARIZARD.predictedGrade,
          CHARIZARD.imageHash
        )
      )
        .to.emit(notary, "CertificateNotarized")
        .withArgs(0, owner.address, CHARIZARD.cardName, CHARIZARD.predictedGrade);
    });

    it("should emit CertificateNotarized with correct data for non-owner caller", async function () {
      await expect(
        notary.connect(other).notarizeGrade(
          BLACK_LOTUS.cardName,
          BLACK_LOTUS.predictedGrade,
          BLACK_LOTUS.imageHash
        )
      )
        .to.emit(notary, "CertificateNotarized")
        .withArgs(0, other.address, BLACK_LOTUS.cardName, BLACK_LOTUS.predictedGrade);
    });

    it("should return the token ID", async function () {
      // Use staticCall to get the return value
      const tokenId = await notary.notarizeGrade.staticCall(
        CHARIZARD.cardName,
        CHARIZARD.predictedGrade,
        CHARIZARD.imageHash
      );

      expect(tokenId).to.equal(0);
    });

    it("should auto-increment token IDs", async function () {
      await notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, CHARIZARD.imageHash);
      await notary.connect(other).notarizeGrade(BLACK_LOTUS.cardName, BLACK_LOTUS.predictedGrade, BLACK_LOTUS.imageHash);
      await notary.notarizeGrade(BLUE_EYES.cardName, BLUE_EYES.predictedGrade, BLUE_EYES.imageHash);

      expect(await notary.ownerOf(0)).to.equal(owner.address);
      expect(await notary.ownerOf(1)).to.equal(other.address);
      expect(await notary.ownerOf(2)).to.equal(owner.address);
    });
  });

  // ─── Certificate Data Integrity ─────────────────────────────

  describe("Certificate Data Integrity", function () {
    it("should store correct cardName", async function () {
      await notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, CHARIZARD.imageHash);
      const cert = await notary.certificates(0);
      expect(cert.cardName).to.equal(CHARIZARD.cardName);
    });

    it("should store correct predictedGrade", async function () {
      await notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, CHARIZARD.imageHash);
      const cert = await notary.certificates(0);
      expect(cert.predictedGrade).to.equal(CHARIZARD.predictedGrade);
    });

    it("should store correct imageHash", async function () {
      await notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, CHARIZARD.imageHash);
      const cert = await notary.certificates(0);
      expect(cert.imageHash).to.equal(CHARIZARD.imageHash);
    });

    it("should store correct timestamp (block.timestamp)", async function () {
      const tx = await notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, CHARIZARD.imageHash);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      const cert = await notary.certificates(0);
      expect(cert.timestamp).to.equal(block.timestamp);
    });

    it("should store correct notarizedBy (msg.sender)", async function () {
      await notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, CHARIZARD.imageHash);
      const cert = await notary.certificates(0);
      expect(cert.notarizedBy).to.equal(owner.address);
    });

    it("should store correct notarizedBy when called by non-owner", async function () {
      await notary.connect(other).notarizeGrade(BLACK_LOTUS.cardName, BLACK_LOTUS.predictedGrade, BLACK_LOTUS.imageHash);
      const cert = await notary.certificates(0);
      expect(cert.notarizedBy).to.equal(other.address);
    });

    it("should keep certificates independent across token IDs", async function () {
      await notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, CHARIZARD.imageHash);
      await notary.notarizeGrade(BLACK_LOTUS.cardName, BLACK_LOTUS.predictedGrade, BLACK_LOTUS.imageHash);

      const cert0 = await notary.certificates(0);
      const cert1 = await notary.certificates(1);

      expect(cert0.cardName).to.equal(CHARIZARD.cardName);
      expect(cert1.cardName).to.equal(BLACK_LOTUS.cardName);
      expect(cert0.predictedGrade).to.equal(CHARIZARD.predictedGrade);
      expect(cert1.predictedGrade).to.equal(BLACK_LOTUS.predictedGrade);
    });
  });

  // ─── getCertificate ──────────────────────────────────────────

  describe("getCertificate", function () {
    it("should return full certificate struct", async function () {
      await notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, CHARIZARD.imageHash);
      const cert = await notary.getCertificate(0);

      expect(cert.cardName).to.equal(CHARIZARD.cardName);
      expect(cert.predictedGrade).to.equal(CHARIZARD.predictedGrade);
      expect(cert.imageHash).to.equal(CHARIZARD.imageHash);
      expect(cert.timestamp).to.be.gt(0);
      expect(cert.notarizedBy).to.equal(owner.address);
    });

    it("should revert for non-existent token", async function () {
      await expect(
        notary.getCertificate(0)
      ).to.be.reverted; // ERC721NonexistentToken or similar
    });

    it("should revert for token ID that was never minted", async function () {
      await notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, CHARIZARD.imageHash);

      await expect(
        notary.getCertificate(999)
      ).to.be.reverted;
    });

    it("should allow anyone to read a certificate", async function () {
      await notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, CHARIZARD.imageHash);
      const cert = await notary.connect(other).getCertificate(0);
      expect(cert.cardName).to.equal(CHARIZARD.cardName);
    });
  });

  // ─── ERC721 Behavior ──────────────────────────────────────────

  describe("ERC721 Behavior", function () {
    it("should support ERC721 transfers", async function () {
      await notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, CHARIZARD.imageHash);

      await notary.transferFrom(owner.address, other.address, 0);
      expect(await notary.ownerOf(0)).to.equal(other.address);
    });

    it("should support safeTransferFrom", async function () {
      await notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, CHARIZARD.imageHash);

      await notary["safeTransferFrom(address,address,uint256)"](owner.address, other.address, 0);
      expect(await notary.ownerOf(0)).to.equal(other.address);
    });

    it("should not allow non-owner to transfer", async function () {
      await notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, CHARIZARD.imageHash);

      await expect(
        notary.connect(other).transferFrom(owner.address, third.address, 0)
      ).to.be.reverted;
    });

    it("should preserve certificate data after transfer", async function () {
      await notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, CHARIZARD.imageHash);
      await notary.transferFrom(owner.address, other.address, 0);

      // Certificate data should still be intact
      const cert = await notary.getCertificate(0);
      expect(cert.cardName).to.equal(CHARIZARD.cardName);
      expect(cert.notarizedBy).to.equal(owner.address); // original minter
    });

    it("should track balances correctly across multiple mints", async function () {
      await notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, CHARIZARD.imageHash);
      await notary.notarizeGrade(BLACK_LOTUS.cardName, BLACK_LOTUS.predictedGrade, BLACK_LOTUS.imageHash);
      await notary.connect(other).notarizeGrade(BLUE_EYES.cardName, BLUE_EYES.predictedGrade, BLUE_EYES.imageHash);

      expect(await notary.balanceOf(owner.address)).to.equal(2);
      expect(await notary.balanceOf(other.address)).to.equal(1);
    });
  });

  // ─── Ownership ─────────────────────────────────────────────

  describe("Ownership", function () {
    it("should allow owner to transfer ownership", async function () {
      await notary.transferOwnership(other.address);
      expect(await notary.owner()).to.equal(other.address);
    });

    it("should reject ownership transfer from non-owner", async function () {
      await expect(
        notary.connect(other).transferOwnership(third.address)
      ).to.be.revertedWithCustomError(notary, "OwnableUnauthorizedAccount");
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────────

  describe("Edge Cases", function () {
    it("should reject empty cardName", async function () {
      await expect(
        notary.notarizeGrade("", CHARIZARD.predictedGrade, CHARIZARD.imageHash)
      ).to.be.revertedWith("GradeNotary: Invalid cardName length");
    });

    it("should reject empty predictedGrade", async function () {
      await expect(
        notary.notarizeGrade(CHARIZARD.cardName, "", CHARIZARD.imageHash)
      ).to.be.revertedWith("GradeNotary: Invalid predictedGrade length");
    });

    it("should reject imageHash shorter than 10 chars", async function () {
      await expect(
        notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, "short")
      ).to.be.revertedWith("GradeNotary: Invalid imageHash length");
    });

    it("should reject empty imageHash", async function () {
      await expect(
        notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, "")
      ).to.be.revertedWith("GradeNotary: Invalid imageHash length");
    });

    it("should reject cardName exceeding 150 chars", async function () {
      const longName = "A".repeat(151);
      await expect(
        notary.notarizeGrade(longName, CHARIZARD.predictedGrade, CHARIZARD.imageHash)
      ).to.be.revertedWith("GradeNotary: Invalid cardName length");
    });

    it("should accept cardName at exactly 150 chars", async function () {
      const maxName = "A".repeat(150);
      await notary.notarizeGrade(maxName, CHARIZARD.predictedGrade, CHARIZARD.imageHash);
      const cert = await notary.certificates(0);
      expect(cert.cardName).to.equal(maxName);
    });

    it("should reject predictedGrade exceeding 50 chars", async function () {
      const longGrade = "G".repeat(51);
      await expect(
        notary.notarizeGrade(CHARIZARD.cardName, longGrade, CHARIZARD.imageHash)
      ).to.be.revertedWith("GradeNotary: Invalid predictedGrade length");
    });

    it("should accept predictedGrade at exactly 50 chars", async function () {
      const maxGrade = "G".repeat(50);
      await notary.notarizeGrade(CHARIZARD.cardName, maxGrade, CHARIZARD.imageHash);
      const cert = await notary.certificates(0);
      expect(cert.predictedGrade).to.equal(maxGrade);
    });

    it("should reject imageHash exceeding 200 chars", async function () {
      const longHash = "H".repeat(201);
      await expect(
        notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, longHash)
      ).to.be.revertedWith("GradeNotary: Invalid imageHash length");
    });

    it("should accept imageHash at exactly 200 chars", async function () {
      const maxHash = "H".repeat(200);
      await notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, maxHash);
      const cert = await notary.certificates(0);
      expect(cert.imageHash).to.equal(maxHash);
    });

    it("should accept imageHash at exactly 10 chars (minimum)", async function () {
      const minHash = "H".repeat(10);
      await notary.notarizeGrade(CHARIZARD.cardName, CHARIZARD.predictedGrade, minHash);
      const cert = await notary.certificates(0);
      expect(cert.imageHash).to.equal(minHash);
    });

    it("should handle many sequential mints", async function () {
      for (let i = 0; i < 20; i++) {
        await notary.notarizeGrade(
          `Card #${i}`,
          `PSA ${(i % 10) + 1}`,
          `QmHash${i}abcdefghijklmnopqrstuvwxyz0123456789`
        );
      }

      expect(await notary.balanceOf(owner.address)).to.equal(20);

      const cert0 = await notary.certificates(0);
      expect(cert0.cardName).to.equal("Card #0");

      const cert19 = await notary.certificates(19);
      expect(cert19.cardName).to.equal("Card #19");
    });

    it("should handle unicode/special characters in cardName", async function () {
      const unicodeName = "Pokémon — Pikachu ⚡ VMAX";
      await notary.notarizeGrade(unicodeName, "PSA 10", "QmAbCdEfGhIjKlMnOpQrStUvWxYz1234567890abcdef");
      const cert = await notary.certificates(0);
      expect(cert.cardName).to.equal(unicodeName);
    });
  });
});
