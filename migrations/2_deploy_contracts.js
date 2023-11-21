const CBDC = artifacts.require("CBDC.sol");

module.exports = (deployer, network, accounts) => {
    const mainAccount = accounts[0];

    // deployer.deploy(safeSecurity, {from: accounts[0]}).then(function() {
    //     return deployer.deploy(CBDC,{from: accounts[0]}).then(function(){
    //         return deployer.deploy(
    //             icf, 
    //             collateralRate,
    //             claimBackedRate,
    //             unsecuredRate,
    //             safeSecurity.address,
    //             CBDC.address,
    //             {from: accounts[0]}
    //         )
    //     });
    // });

    deployer.deploy(
        CBDC, 
        {from: mainAccount}
    );
};