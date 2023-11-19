// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./CBDC.sol";
import "./transaction.sol";

interface ITransactionContract {
    function getTransaction() external view returns (address, address, uint256, string memory, string memory, bool, bool);
}

contract ICF {
    IERC20 public safeToken;
    CBDC public cbdcToken;

    // Rates
    // Should be expressed as a factor of 100 due to the limitation of Solidity not being abel to handle floating points
    uint256 private collateralOpportunityRate; 
    uint256 private claimBackedRate;
    uint256 private unsecuredRate;

    // Credit records
    struct CreditRecord {
        uint256 amount;
        string period;
    }
    struct ClaimBackedCreditRecord {
        uint256 amount;
        string period;
        address transactionAddress;
    }

    mapping(address => CreditRecord[]) public collateralizedCredits;
    mapping(address => ClaimBackedCreditRecord[]) public claimBackedCredits;
    mapping(address => CreditRecord[]) public unsecuredCredits;

    // Constructor
    constructor(uint256 _collateralOpportunityRate, uint256 _claimBackedRate, uint256 _unsecuredRate, address _safeTokenAddress, address _cbdcTokenAddress) {
        collateralOpportunityRate = _collateralOpportunityRate;
        claimBackedRate = _claimBackedRate;
        unsecuredRate = _unsecuredRate;
        safeToken = IERC20(_safeTokenAddress);
        cbdcToken = CBDC(_cbdcTokenAddress);
    }

    // Function to obtain collateralized credit
    function obtainCollateralizedCredit(address account, uint256 value, string memory period) public {
        require(safeToken.balanceOf(account) >= value, "Insufficient SAFE tokens");
        safeToken.transferFrom(account, address(this), value);
        cbdcToken.mint(account, value);

        CreditRecord memory newCredit = CreditRecord({
            amount: value,
            period: period
        });
        // Add the new credit record to the account's list of credits
        collateralizedCredits[account].push(newCredit);
    }

    // Function to obtain claim-backed credit
    function obtainClaimBackedCredit(address account, uint256 value, address transactionAddress, string memory period) public {
        // extract transaction details
        ITransactionContract transaction = ITransactionContract(transactionAddress);
        (address payor, address recipient, uint256 amount,,, bool isOpen, bool isCancelled) = transaction.getTransaction();

        require(recipient == account, "Account must be the recipient");
        require(amount >= value, "Transaction value too low");
        require(isOpen && !isCancelled, "Transaction is not open or has been cancelled");
        // Check if the transaction has been recorded before
        ClaimBackedCreditRecord[] storage credits = claimBackedCredits[account];
        for (uint i = 0; i < credits.length; i++) {
            require(credits[i].transactionAddress != transactionAddress, "Transaction already used for credit");
        }

        // Mint CBDC tokens to the account
        cbdcToken.mint(account, value);

        // Create a new claim-backed credit record
        ClaimBackedCreditRecord memory newCredit = ClaimBackedCreditRecord({
            amount: value,
            period: period,
            transactionAddress: transactionAddress
        });

        // Add the new credit record to the account's list of claim-backed credits
        claimBackedCredits[account].push(newCredit);
    }

    // Function to obtain unsecured credit
    function obtainUnsecuredCredit(address account, uint256 value, string memory period) public {
        cbdcToken.mint(account, value);

        CreditRecord memory newCredit = CreditRecord({
            amount: value,
            period: period
        });
        // Add the new credit record to the account's list of credits
        unsecuredCredits[account].push(newCredit);
    }

    function settleCollateralizedCredit(address account, uint256 value, string memory period) public returns(uint256){
        require(cbdcToken.balanceOf(account) >= value, "Insufficient CBDC tokens");

        uint256 remainingValue = value;
        uint256 penalty = 0;
        CreditRecord[] storage credits = collateralizedCredits[account];

        // First, try to settle morning period credits
        for (uint i = 0; i < credits.length && remainingValue > 0; i++) {
            if (keccak256(bytes(credits[i].period)) == keccak256(bytes("morning")) && credits[i].amount > 0) {
                uint256 amountToSettle = credits[i].amount > remainingValue ? remainingValue : credits[i].amount;
                credits[i].amount -= amountToSettle;
                remainingValue -= amountToSettle;
                penalty += calculatePenalty(credits[i].period, period, amountToSettle, collateralOpportunityRate);
                if (credits[i].amount == 0) {
                    removeCreditRecord(credits, i);
                }
            }
        }

        // Next, try to settle afternoon period credits
        for (uint i = 0; i < credits.length && remainingValue > 0; i++) {
            if (keccak256(bytes(credits[i].period)) == keccak256(bytes("afternoon")) && credits[i].amount > 0) {
                uint256 amountToSettle = credits[i].amount > remainingValue ? remainingValue : credits[i].amount;
                credits[i].amount -= amountToSettle;
                remainingValue -= amountToSettle;
                penalty += calculatePenalty(credits[i].period, period, amountToSettle, collateralOpportunityRate);
                if (credits[i].amount == 0) {
                    removeCreditRecord(credits, i);
                }
            }
        }

        require(remainingValue == 0, "Unable to settle the full amount with available credits");

        cbdcToken.burnFrom(account, value); // Burn the CBDC tokens

        return penalty;
    }

    function settleClaimBackedCredit(address account, uint256 value, string memory period) public returns(uint256){
        require(cbdcToken.balanceOf(account) >= value, "Insufficient CBDC tokens");

        uint256 remainingValue = value;
        uint256 penalty = 0;
        ClaimBackedCreditRecord[] storage credits = claimBackedCredits[account];

        // First, try to settle morning period credits
        for (uint i = 0; i < credits.length && remainingValue > 0; i++) {
            if (keccak256(bytes(credits[i].period)) == keccak256(bytes("morning")) && credits[i].amount > 0) {
                uint256 amountToSettle = credits[i].amount > remainingValue ? remainingValue : credits[i].amount;
                credits[i].amount -= amountToSettle;
                remainingValue -= amountToSettle;
                penalty += calculatePenalty(credits[i].period, period, amountToSettle, claimBackedRate);
                if (credits[i].amount == 0) {
                    removeClaimBackedCreditRecord(credits, i);
                }
            }
        }

        // Next, try to settle afternoon period credits
        for (uint i = 0; i < credits.length && remainingValue > 0; i++) {
            if (keccak256(bytes(credits[i].period)) == keccak256(bytes("afternoon")) && credits[i].amount > 0) {
                uint256 amountToSettle = credits[i].amount > remainingValue ? remainingValue : credits[i].amount;
                credits[i].amount -= amountToSettle;
                remainingValue -= amountToSettle;
                penalty += calculatePenalty(credits[i].period, period, amountToSettle, claimBackedRate);
                if (credits[i].amount == 0) {
                    removeClaimBackedCreditRecord(credits, i);
                }
            }
        }

        require(remainingValue == 0, "Unable to settle the full amount with available credits");

        cbdcToken.burnFrom(account, value); // Burn the CBDC tokens

        return penalty;
    }

    // Helper function to remove a claim-backed credit record
    function removeClaimBackedCreditRecord(ClaimBackedCreditRecord[] storage credits, uint index) internal {
        require(index < credits.length, "Index out of bounds");

        for (uint i = index; i < credits.length - 1; i++) {
            credits[i] = credits[i + 1];
        }
        credits.pop();
    }


    function settleUnsecuredCredit(address account, uint256 value, string memory period) public returns(uint256){
        require(cbdcToken.balanceOf(account) >= value, "Insufficient CBDC tokens");

        uint256 remainingValue = value;
        uint256 penalty = 0;
        CreditRecord[] storage credits = unsecuredCredits[account];

        // First, try to settle morning period credits
        for (uint i = 0; i < credits.length && remainingValue > 0; i++) {
            if (keccak256(bytes(credits[i].period)) == keccak256(bytes("morning")) && credits[i].amount > 0) {
                uint256 amountToSettle = credits[i].amount > remainingValue ? remainingValue : credits[i].amount;
                credits[i].amount -= amountToSettle;
                remainingValue -= amountToSettle;
                penalty += calculatePenalty(credits[i].period, period, amountToSettle, unsecuredRate);
                if (credits[i].amount == 0) {
                    removeCreditRecord(credits, i);
                }
            }
        }

        // Next, try to settle afternoon period credits
        for (uint i = 0; i < credits.length && remainingValue > 0; i++) {
            if (keccak256(bytes(credits[i].period)) == keccak256(bytes("afternoon")) && credits[i].amount > 0) {
                uint256 amountToSettle = credits[i].amount > remainingValue ? remainingValue : credits[i].amount;
                credits[i].amount -= amountToSettle;
                remainingValue -= amountToSettle;
                penalty += calculatePenalty(credits[i].period, period, amountToSettle, unsecuredRate);
                if (credits[i].amount == 0) {
                    removeCreditRecord(credits, i);
                }
            }
        }

        require(remainingValue == 0, "Unable to settle the full amount with available credits");

        cbdcToken.burnFrom(account, value); // Burn the CBDC tokens

        return penalty;
    }

    // // Transfer CBDC token
    // function transferCBDC(address fromPlayer, address toPlayer, uint256 amount) external {
    //     cbdcToken.transferFrom(fromPlayer, toPlayer, amount);
    // }

    // // Check CBDC balance
    // function checkCBDCBalance(address account) external returns(uint256){
    //     return cbdcToken.balanceOf(account);
    // }

    // Helper function to remove a credit record
    function removeCreditRecord(CreditRecord[] storage credits, uint index) internal {
        require(index < credits.length, "Index out of bounds");

        for (uint i = index; i < credits.length - 1; i++) {
            credits[i] = credits[i + 1];
        }
        credits.pop();
    }

    function calculatePenalty(string memory startPeriod, string memory currentPeriod, uint256 amount, uint256 rate) internal returns(uint256) {
        uint256 penalty = 0;
        if (keccak256(bytes(startPeriod)) == keccak256(bytes(currentPeriod))) {
            penalty = (amount * rate)/100;
        } else if (keccak256(bytes(startPeriod)) == keccak256(bytes("morning")) && keccak256(bytes(currentPeriod)) == keccak256(bytes("afternoon"))) {
            penalty = (amount * rate * 2)/100;
        }

        return penalty;
    }
}
