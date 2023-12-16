// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../node_modules/@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISystemContract {
    function loadTransactionContract(address transactionAddress) external;
}

contract TransactionContract {
    IERC20 public cbdcToken;

    struct Transaction {
        address payor;
        address recipient;
        uint256 amount;
        string creationPeriod;
        string settlementPeriod;
        bool isOpen;
        bool isCancelled;
    }

    Transaction public transaction;

    event TransactionCreated(address indexed payor, address indexed recipient, uint256 amount, string creationPeriod);
    event TransactionSettled(string settlementPeriod);
    event TransactionCancelled();

    constructor(address _cbdcTokenAddress, address _payor, address _recipient, uint256 _amount, string memory _creationPeriod) {
        cbdcToken = IERC20(_cbdcTokenAddress);
        transaction = Transaction({
            payor: _payor,
            recipient: _recipient,
            amount: _amount,
            creationPeriod: _creationPeriod,
            settlementPeriod: "",
            isOpen: true,
            isCancelled: false
        });

        emit TransactionCreated(_payor, _recipient, _amount, _creationPeriod);
    }

    function settleTransaction(string memory _settlementPeriod) public {
        require(transaction.isOpen, "Transaction is already settled or cancelled.");
        transaction.isOpen = false;
        transaction.settlementPeriod = _settlementPeriod;

        require(cbdcToken.transfer(transaction.recipient, transaction.amount), "Transfer failed");

        emit TransactionSettled(_settlementPeriod);
    }

    function cancelTransaction() public {
        // require(msg.sender == transaction.payor, "Only the payor can cancel the transaction.");
        require(transaction.isOpen, "Transaction is already settled or cancelled.");
        transaction.isOpen = false;
        transaction.isCancelled = true;

        require(cbdcToken.transfer(transaction.payor, transaction.amount), "Refund failed");

        emit TransactionCancelled();
    }

    function getTransaction() public view returns (address, address, uint256, string memory, string memory, bool, bool) {
        return (transaction.payor, transaction.recipient, transaction.amount, transaction.creationPeriod, transaction.settlementPeriod, transaction.isOpen, transaction.isCancelled);
    }

    // Function to load this contract into a specified systemContract
    function loadIntoSystemContract(address systemContract) public {
        ISystemContract system = ISystemContract(systemContract);
        system.loadTransactionContract(address(this));
    }
}
