const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SoulPredictionOracle", function () {
  let oracle, owner, stranger;
  const WEEK = 20260701;
  const ROOT = "0x56da5c8be3b8eaf7cd48cc64fa7a79c9b6b8b8d4a5273ee8a30a3712d3d6331f";

  beforeEach(async () => {
    [owner, stranger] = await ethers.getSigners();
    const F = await ethers.getContractFactory("SoulPredictionOracle");
    oracle = await F.deploy();
  });

  it("commits a weekly root and stores it", async () => {
    await expect(oracle.commitRoot(WEEK, ROOT, 819))
      .to.emit(oracle, "RootCommitted");
    const c = await oracle.commitments(WEEK);
    expect(c.root).to.equal(ROOT);
    expect(c.nPredictions).to.equal(819);
    expect(await oracle.totalWeeks()).to.equal(1);
  });

  it("IMMUTABILITY: a week can never be committed twice", async () => {
    await oracle.commitRoot(WEEK, ROOT, 819);
    await expect(oracle.commitRoot(WEEK, ethers.hexlify(ethers.randomBytes(32)), 1))
      .to.be.revertedWith("week already committed");
  });

  it("rejects non-owner commits", async () => {
    await expect(oracle.connect(stranger).commitRoot(WEEK, ROOT, 819))
      .to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
  });

  it("rejects empty roots and bad weekIds", async () => {
    await expect(oracle.commitRoot(WEEK, ethers.ZeroHash, 1)).to.be.revertedWith("empty root");
    await expect(oracle.commitRoot(123, ROOT, 1)).to.be.revertedWith("weekId = yyyymmdd");
  });

  it("verifies a real proof against a committed root (sorted-pair, OZ convention)", async () => {
    // build a tiny 4-leaf tree exactly like the off-chain builder
    const leaves = [1, 2, 3, 4].map(i =>
      ethers.keccak256(ethers.concat([ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "uint256", "uint256", "string", "bytes32"],
          [i, WEEK, 1000 + i, i % 2 ? "up" : "down", ethers.keccak256(ethers.toUtf8Bytes(`lock${i}`))]
        ))]))
    );
    const pair = (a, b) => a.toLowerCase() <= b.toLowerCase()
      ? ethers.keccak256(ethers.concat([a, b]))
      : ethers.keccak256(ethers.concat([b, a]));
    const n01 = pair(leaves[0], leaves[1]);
    const n23 = pair(leaves[2], leaves[3]);
    const root = pair(n01, n23);

    await oracle.commitRoot(20260708, root, 4);
    // proof for leaf 0: sibling leaf1, then node n23
    expect(await oracle.verifyPrediction(20260708, leaves[0], [leaves[1], n23])).to.equal(true);
    // wrong proof fails
    expect(await oracle.verifyPrediction(20260708, leaves[0], [leaves[2], n23])).to.equal(false);
  });

  it("latest() returns the newest week", async () => {
    await oracle.commitRoot(WEEK, ROOT, 819);
    await oracle.commitRoot(20260708, ethers.hexlify(ethers.randomBytes(32)), 800);
    const [weekId, c] = await oracle.latest();
    expect(weekId).to.equal(20260708);
    expect(c.nPredictions).to.equal(800);
  });
});
