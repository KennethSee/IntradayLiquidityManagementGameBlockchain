// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../node_modules/@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../node_modules/@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "../node_modules/@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "../node_modules/@openzeppelin/contracts/access/Ownable.sol";

contract CBDC is ERC20, ERC20Permit, ERC20Burnable, Ownable {
    constructor() ERC20("CBDC", "SEE") ERC20Permit("CBDC") Ownable(msg.sender) {}

    // Function to mint tokens
    // Only the owner of the contract can call this function
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    // Override the burn function to track the total supply correctly
    function burn(uint256 amount) public override {
        super.burn(amount);
    }

    // Override the burnFrom function to track the total supply correctly
    function burnFrom(address account, uint256 amount) public override {
        super.burnFrom(account, amount);
    }
}