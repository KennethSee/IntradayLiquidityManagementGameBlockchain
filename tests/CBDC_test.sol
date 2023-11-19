// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.7.0 <0.9.0;
import "remix_tests.sol";
import "../contracts/CBDC.sol";

contract CBDCTest is CBDC {

    function testTokenInitialValues() public {
        Assert.equal(name(), "CBDC", "token name did not match");
        Assert.equal(symbol(), "SEE", "token symbol did not match");
        Assert.equal(decimals(), 18, "token decimals did not match");
        Assert.equal(totalSupply(), 0, "token supply should be zero");
    }
}