// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./CBDC.sol";

interface ITransactionContract {
    function settleTransaction(string memory _settlementPeriod) external;
    function cancelTransaction() external;
    function getTransaction() external view returns (address, address, uint256, string memory, string memory, bool, bool);
}

// interface IICF {
//     function transferCBDC(address fromPlayer, address toPlayer, uint256 amount) external;
//     function checkCBDCBalance(address account) external returns(uint256);
// }

contract System {
    address public player1;
    address public player2;
    address public icf;
    // IICF public icf_contract;
    string public currentPeriod;
    CBDC public cbdcToken;
    uint256 delayCost;
    uint256 additionalDelayCost;

    mapping(address => ITransactionContract[]) public playerTransactions;
    mapping(address => mapping(string => bool)) private periodTransactionExists;
    mapping(address => int256) private delayCostOrCredit;

    enum Period { Morning, Afternoon, EndOfDay }
    Period private periodState = Period.Morning;

    constructor(address _player1, address _player2, address _icf, address _cbdcToken, uint256 _delayCost, uint256 _additionalDelayCost) {
        player1 = _player1;
        player2 = _player2;
        icf = _icf;
        currentPeriod = "morning";
        cbdcToken = CBDC(_cbdcToken);
        delayCost= _delayCost;
        additionalDelayCost = _additionalDelayCost;
    }

    function nextPeriod() public {
        require(periodState != Period.EndOfDay, "Already at end-of-day");
        int256 delayCostAmount;
        int256 additionalDelayCostAmount;
        if (periodState == Period.Morning) {
            // calculate delay costs at the end of the morning period
            (delayCostAmount, additionalDelayCostAmount) = calculateDelayPenalties(player1);
            delayCostOrCredit[player1] += delayCostAmount + additionalDelayCostAmount;
            delayCostOrCredit[player2] -= additionalDelayCostAmount;
            (delayCostAmount, additionalDelayCostAmount) = calculateDelayPenalties(player2);
            delayCostOrCredit[player2] += delayCostAmount + additionalDelayCostAmount;
            delayCostOrCredit[player1] -= additionalDelayCostAmount;

            currentPeriod = "afternoon";
            periodState = Period.Afternoon;
        } else if (periodState == Period.Afternoon) {
            currentPeriod = "end-of-day";
            periodState = Period.EndOfDay;
        } else if (periodState == Period.EndOfDay) {
            cancelUnsettledTransactions();
        }
    }

    function loadTransactionContract(address transactionAddress) public {
        ITransactionContract transaction = ITransactionContract(transactionAddress);
        (address payor, address recipient,, string memory creationPeriod,, bool isOpen,) = transaction.getTransaction();

        require(isOpen, "Transaction is already settled or cancelled.");
        require((payor == player1 || payor == player2), "Invalid payor.");
        require((recipient == player1 || recipient == player2), "Invalid recipient.");
        require((player1 != player2), "Transaction cannot be to self.");
        require(keccak256(bytes(creationPeriod)) == keccak256(bytes(currentPeriod)), "Transaction period mismatch.");
        require(!periodTransactionExists[payor][creationPeriod], "Transaction for this period and payor already exists.");
        require(playerTransactions[payor].length < 2, "Maximum of two transactions per player allowed.");

        playerTransactions[payor].push(transaction);
        periodTransactionExists[payor][creationPeriod] = true;
    }

    function settleTransaction(address transactionAddress) public {
        require(keccak256(bytes(currentPeriod)) != keccak256(bytes("end-of-day")), "Cannot settle during end-of-day.");
        ITransactionContract transaction = ITransactionContract(transactionAddress);
        transaction.settleTransaction(currentPeriod);
    }

    function cancelUnsettledTransactions() private {
        cancelPlayerTransactions(player1);
        cancelPlayerTransactions(player2);
    }

    function cancelPlayerTransactions(address player) private {
        for (uint i = 0; i < playerTransactions[player].length; i++) {
            (,,, string memory settlementPeriod,, bool isOpen,) = playerTransactions[player][i].getTransaction();
            if (isOpen && bytes(settlementPeriod).length == 0) {
                playerTransactions[player][i].cancelTransaction();
            }
        }
    }

    // function to redistribute liquidity at the end of the day
    function eodRebalance() private {
        require(keccak256(bytes(currentPeriod)) == keccak256(bytes("afternoon")), "This function can only be executed right before EOD.");
        
        // Process rebalance for each player
        _processRebalanceForPlayer(player1);
        _processRebalanceForPlayer(player2);
    }

    // Internal function to process rebalance for a given player
    function _processRebalanceForPlayer(address player) internal {
        // address[] memory transactions = playerTransactions[player];
        ITransactionContract[] storage transactions = playerTransactions[player];
        address[] memory tempTransactions = new address[](transactions.length);
        for (uint j = 0; j < transactions.length; j++) {
            tempTransactions[j] = address(transactions[j]);
        }

        for (uint j = 0; j < tempTransactions.length; j++) {
            ITransactionContract transaction = ITransactionContract(tempTransactions[j]);
            (address payor, address recipient, uint256 amount,,, bool isOpen,) = transaction.getTransaction();

            // Check if the transaction is open
            if (isOpen) {
                // Check if payor has sufficient CBDC tokens
                if (cbdcToken.balanceOf(payor) < amount) {
                    // Check if recipient has sufficient CBDC tokens
                    if (cbdcToken.balanceOf(recipient) >= amount) {
                        // Transfer CBDC tokens from recipient to payor
                        cbdcToken.transferFrom(recipient, payor, amount);

                        // Settle the transaction
                        transaction.settleTransaction("end-of-day");
                    }
                }
            }
        }
    }

    function calculateDelayPenalties(address player) internal view returns(int256, int256){
        int256 totalDelayCost;
        int256 totalAdditionaDelayCost;
        ITransactionContract[] storage transactions = playerTransactions[player];
        for (uint i = 0; i < transactions.length; i++) {
            ITransactionContract transaction = transactions[i];
            (,, uint256 amount,,, bool isOpen,) = transaction.getTransaction();
            if (isOpen) {
                totalDelayCost += (int256(amount) * int256(delayCost))/100;
                totalAdditionaDelayCost += (int256(amount) * int256(additionalDelayCost))/100;
            }
        }
        return (totalDelayCost, totalAdditionaDelayCost);
    }
}
