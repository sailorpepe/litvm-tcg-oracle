// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title GradeNotary
 * @dev Mints "Proof of Grade" certificates as NFTs on LitVM.
 * Bridges physical card grading AI predictions with on-chain verification.
 */
contract GradeNotary is ERC721, Ownable, ReentrancyGuard {
    using Strings for uint256;

    uint256 private _nextTokenId;

    struct GradeCertificate {
        string cardName;
        string predictedGrade;
        string imageHash;
        uint256 timestamp;
        address notarizedBy;
    }

    mapping(uint256 => GradeCertificate) public certificates;

    event CertificateNotarized(uint256 indexed tokenId, address indexed owner, string cardName, string grade);

    constructor(address initialOwner) ERC721("TCG Grade Notary", "GRADE") Ownable(initialOwner) {}

    /**
     * @dev Mint a new Grade Certificate NFT.
     * @param cardName The name of the card (e.g., "Charizard Base Set")
     * @param predictedGrade The AI predicted grade (e.g., "PSA 9")
     * @param imageHash IPFS hash or URI of the scanned card image
     */
    function notarizeGrade(
        string memory cardName,
        string memory predictedGrade,
        string memory imageHash
    ) external nonReentrant returns (uint256) {
        bytes memory nameBytes = bytes(cardName);
        bytes memory gradeBytes = bytes(predictedGrade);
        bytes memory hashBytes = bytes(imageHash);

        require(nameBytes.length > 0 && nameBytes.length <= 150, "GradeNotary: Invalid cardName length");
        require(gradeBytes.length > 0 && gradeBytes.length <= 50, "GradeNotary: Invalid predictedGrade length");
        require(hashBytes.length >= 10 && hashBytes.length <= 200, "GradeNotary: Invalid imageHash length");

        uint256 tokenId = _nextTokenId++;
        
        certificates[tokenId] = GradeCertificate({
            cardName: cardName,
            predictedGrade: predictedGrade,
            imageHash: imageHash,
            timestamp: block.timestamp,
            notarizedBy: msg.sender
        });

        _safeMint(msg.sender, tokenId);
        
        emit CertificateNotarized(tokenId, msg.sender, cardName, predictedGrade);
        
        return tokenId;
    }

    /**
     * @dev Retrieve certificate details.
     */
    function getCertificate(uint256 tokenId) external view returns (GradeCertificate memory) {
        require(ownerOf(tokenId) != address(0), "Certificate does not exist");
        return certificates[tokenId];
    }
}
