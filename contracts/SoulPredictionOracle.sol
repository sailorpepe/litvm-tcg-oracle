// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title SoulPredictionOracle
 * @notice Weekly, immutable Merkle commitments of The Undesirables' soul
 *         prediction lock-hashes — committed on-chain BEFORE outcomes exist.
 *
 * The system:
 *   - Every Monday, each minted Undesirable soul locks 3 deterministic market
 *     predictions (derived from its on-chain personality traits + the public
 *     nightly forecast board — recomputable by anyone).
 *   - The Mac Mini builds a Merkle tree of all lock-hashes for the week and
 *     commits the single 32-byte root here, in the same transaction window
 *     the predictions are locked — i.e. before any outcome is knowable.
 *   - 30 days later the conformal oracle grades every call; because the root
 *     is IMMUTABLE per week (no overwrite path exists), no prediction can be
 *     edited, backdated, or deleted after the fact.
 *
 * This is the trust anchor for the public soul track records
 * (the-undesirables.com/souls · /api/v1/soul-rating).
 *
 * Leaf encoding:
 *   keccak256(bytes.concat(keccak256(abi.encode(
 *     tokenId, asOf, productId, direction, lockHash))))
 *   Double-hash (OpenZeppelin standard), sorted-pair internal nodes —
 *   identical convention to MerklePriceOracle.
 *
 * @author Meme Merchants — sailorpepe.eth
 * @custom:security-contact security@the-undesirables.com
 */
contract SoulPredictionOracle is Ownable2Step {

    struct Commitment {
        bytes32 root;          // Merkle root of the week's lock-hashes
        uint32  nPredictions;  // number of leaves committed
        uint64  timestamp;     // block time of commitment
    }

    /// @notice weekId (as_of date as yyyymmdd, e.g. 20260701) => commitment
    mapping(uint256 => Commitment) public commitments;

    /// @notice ordered list of committed weekIds (audit trail / enumeration)
    uint256[] public weekIds;

    // ─── Events ───────────────────────────────────────────

    event RootCommitted(
        uint256 indexed weekId,
        bytes32 indexed root,
        uint32 nPredictions,
        uint256 timestamp
    );

    constructor() Ownable(msg.sender) {}

    // ─── Write (owner = the Mac Mini oracle operator) ─────

    /**
     * @notice Commit the week's prediction root. IMMUTABLE: a weekId can
     *         only ever be committed once — there is deliberately no update
     *         or delete path. That immutability IS the product.
     */
    function commitRoot(
        uint256 _weekId,
        bytes32 _root,
        uint32 _nPredictions
    ) external onlyOwner {
        require(_root != bytes32(0), "empty root");
        require(_weekId >= 20260101 && _weekId <= 21000101, "weekId = yyyymmdd");
        require(commitments[_weekId].root == bytes32(0), "week already committed");

        commitments[_weekId] = Commitment({
            root: _root,
            nPredictions: _nPredictions,
            timestamp: uint64(block.timestamp)
        });
        weekIds.push(_weekId);

        emit RootCommitted(_weekId, _root, _nPredictions, block.timestamp);
    }

    // ─── Read / verify ─────────────────────────────────────

    /**
     * @notice Verify a single prediction against a committed weekly root.
     * @param _weekId   the week the prediction was locked (yyyymmdd)
     * @param _leaf     the double-hashed leaf (see leaf encoding above)
     * @param _proof    Merkle proof (sorted-pair convention)
     */
    function verifyPrediction(
        uint256 _weekId,
        bytes32 _leaf,
        bytes32[] calldata _proof
    ) external view returns (bool valid) {
        bytes32 root = commitments[_weekId].root;
        require(root != bytes32(0), "no commitment for week");
        valid = MerkleProof.verify(_proof, root, _leaf);
    }

    /// @notice Number of weeks committed so far.
    function totalWeeks() external view returns (uint256) {
        return weekIds.length;
    }

    /// @notice Latest committed week + its commitment (0s if none yet).
    function latest() external view returns (uint256 weekId, Commitment memory c) {
        if (weekIds.length == 0) return (0, Commitment(bytes32(0), 0, 0));
        weekId = weekIds[weekIds.length - 1];
        c = commitments[weekId];
    }
}
