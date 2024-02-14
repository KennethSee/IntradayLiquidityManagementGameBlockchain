// Right click on the script name and hit "Run" to execute
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Tests", function () {
  it("test initial value", async function () {
    const CBDC = await ethers.getContractFactory("CBDC");
    const cbdc = await CBDC.deploy();
    await cbdc.deployed();

    console.log('cbdc deployed at: ' + cbdc.address);
    // const supply = await cbdc.totalSupply();
    // console.log('Tokens in circulation: ' + supply)
  });
  it("test transaction mechanism", async function () {
    const [deployer] = await ethers.getSigners(); 
    const player1 = "0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c";
    const player1Signer = await ethers.getSigner(player1);
    const player2 = "0x14723A09ACff6D2A60DcdF7aA4AFf308FDDC160C";
    const player2Signer = await ethers.getSigner(player2);
    const amount = 100;

    // deploy CBDC
    const CBDC = await ethers.getContractFactory("CBDC", deployer);
    const cbdc = await CBDC.deploy();
    await cbdc.deployed();

    const Transaction = await ethers.getContractFactory("TransactionContract", deployer);
    const transaction = await Transaction.deploy(
        cbdc.address, //CBDC contract address
        player1, // payor address
        player2, // recipient address
        amount, // amount
        "morning"// creation period
    );
    await transaction.deployed();

    // mint and transfer CBDC tokens to player 1
    await cbdc.mint(player1, amount);

    // approve Transaction contract to spend CBDC tokens
    await cbdc.connect(player1Signer).approve(transaction.address, amount);
    // const allowance = await cbdc.allowance(deployer.address, transaction.address);
    // console.log("Allowance: " + allowance.toString());

    // test transation detailsd
    let txDetails = await transaction.getTransaction();
    expect(txDetails[0]).to.equal(player1);
    expect(txDetails[1]).to.equal(player2);
    expect(txDetails[2]).to.equal(amount);
    expect(txDetails[3]).to.equal("morning");

    // test transaction settlement
    await transaction.connect(deployer).settleTransaction("afternoon");
    txDetails = await transaction.getTransaction();
    expect(txDetails[4]).to.equal("afternoon");
    expect(txDetails[5]).to.be.false;
    const player1Balance = await cbdc.balanceOf(player1);
    const player2Balance = await cbdc.balanceOf(player2);
    expect(player1Balance).to.equal(0);
    expect(player2Balance).to.equal(amount);

  });
  it("test ICF ", async function () {
    const [deployer] = await ethers.getSigners(); 
    const player1 = "0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c";
    const player1Signer = await ethers.getSigner(player1);
    const player2 = "0x14723A09ACff6D2A60DcdF7aA4AFf308FDDC160C";
    const player2Signer = await ethers.getSigner(player2);
    const amount = 100;
    const collateralOpportunityRate = 1;
    const claimBackedRate = 0;
    const unsecuredRate = 3;

    // deploy contracts
    const CBDC = await ethers.getContractFactory("CBDC", deployer);
    const cbdc = await CBDC.deploy();
    await cbdc.deployed();
    const SafeSecurity = await ethers.getContractFactory("SafeSecurity", deployer);
    const safeSecurity = await SafeSecurity.deploy();
    await safeSecurity.deployed();
    const ICF = await ethers.getContractFactory("ICF", deployer);
    const icf = await ICF.deploy(
        collateralOpportunityRate,
        claimBackedRate,
        unsecuredRate,
        safeSecurity.address,
        cbdc.address
    );
    await icf.deployed();
    const Transaction = await ethers.getContractFactory("TransactionContract", deployer);
    const transaction = await Transaction.deploy(
        cbdc.address, //CBDC contract address
        player1, // payor address
        player2, // recipient address
        amount, // amount
        "morning"// creation period
    );
    await transaction.deployed();

    // transfer ownership of CBDC contract to ICF
    await cbdc.transferOwnership(icf.address);

    // test unsecured credit
    await icf.connect(deployer).obtainUnsecuredCredit(player1, amount, "morning");
    expect(await cbdc.balanceOf(player1)).to.equal(amount);
    await cbdc.connect(player1Signer).approve(icf.address, amount);
    let response = await icf.settleUnsecuredCredit(player1, amount, "afternoon");
    let receipt = await response.wait();
    let event = receipt.events.find(event => event.event === "FeeIncurred");
    console.log("Unsecured fee incurred: " + event.args[1].toString());
    expect(await cbdc.balanceOf(player1)).to.equal(0);

    // test collateralized credit
    await expect(icf.connect(deployer).obtainCollateralizedCredit(player1, amount, "morning")).to.be.reverted;
    await safeSecurity.connect(deployer).mint(player1, 100);
    await safeSecurity.connect(player1Signer).approve(icf.address, 100);
    await icf.connect(deployer).obtainCollateralizedCredit(player1, amount, "morning");
    expect(await cbdc.balanceOf(player1)).to.equal(amount);
    await cbdc.connect(player1Signer).approve(icf.address, amount);
    response = await icf.settleCollateralizedCredit(player1, amount, "afternoon");
    receipt = await response.wait();
    event = receipt.events.find(event => event.event === "FeeIncurred");
    console.log("Collaterized opportunity cost: " + event.args[1].toString());
    expect(await cbdc.balanceOf(player1)).to.equal(0);

    // test claim-backed credit
    await expect(icf.connect(deployer).obtainClaimBackedCredit(player1, amount, transaction.address, "morning")).to.be.reverted;
    await icf.connect(deployer).obtainClaimBackedCredit(player2, amount, transaction.address, "morning");
    expect(await cbdc.balanceOf(player2)).to.equal(amount);
    await cbdc.connect(player2Signer).approve(icf.address, amount);
    response = await icf.settleClaimBackedCredit(player2, amount, "afternoon");
    receipt = await response.wait();
    event = receipt.events.find(event => event.event === "FeeIncurred");
    console.log("Claim-backed credit cost: " + event.args[1].toString());
    expect(await cbdc.balanceOf(player2)).to.equal(0);
  });

  it("test system", async function () {
    const [deployer] = await ethers.getSigners(); 
    const player1 = "0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c";
    const player1Signer = await ethers.getSigner(player1);
    const player2 = "0x14723A09ACff6D2A60DcdF7aA4AFf308FDDC160C";
    const player2Signer = await ethers.getSigner(player2);
    const amount = 100;
    const collateralOpportunityRate = 1;
    const claimBackedRate = 0;
    const unsecuredRate = 3;
    const delayCost = 1;
    const additionalDelayCost = 1;

    // deploy contracts
    const CBDC = await ethers.getContractFactory("CBDC", deployer);
    const cbdc = await CBDC.deploy();
    await cbdc.deployed();
    const SafeSecurity = await ethers.getContractFactory("SafeSecurity", deployer);
    const safeSecurity = await SafeSecurity.deploy();
    await safeSecurity.deployed();
    const ICF = await ethers.getContractFactory("ICF", deployer);
    const icf = await ICF.deploy(
        collateralOpportunityRate,
        claimBackedRate,
        unsecuredRate,
        safeSecurity.address,
        cbdc.address
    );
    await icf.deployed();
    const System = await ethers.getContractFactory("System", deployer);
    const system = await System.deploy(
        player1,
        player2,
        icf.address,
        cbdc.address,
        delayCost,
        additionalDelayCost
    );
    await system.deployed();

    // transfer ownership of CBDC contract to ICF
    await cbdc.transferOwnership(icf.address);

    // random number 0 and 1 -> console.log(Math.round(Math.random()));

    // deploy and link morning transactions
    const TransactionMorningPlayer1 = await ethers.getContractFactory("TransactionContract", deployer);
    const transactionMorningPlayer1 = await TransactionMorningPlayer1.deploy(
        cbdc.address, //CBDC contract address
        player1, // payor address
        player2, // recipient address
        amount, // amount
        "morning"// creation period
    );
    await transactionMorningPlayer1.deployed();
    await system.loadTransactionContract(transactionMorningPlayer1.address);
    const TransactionMorningPlayer2 = await ethers.getContractFactory("TransactionContract", deployer);
    const transactionMorningPlayer2 = await TransactionMorningPlayer2.deploy(
        cbdc.address, //CBDC contract address
        player2, // payor address
        player1, // recipient address
        amount, // amount
        "morning"// creation period
    );
    await transactionMorningPlayer2.deployed();
    await system.loadTransactionContract(transactionMorningPlayer2.address);

    // obtain necessary intraday credit
    await icf.connect(deployer).obtainUnsecuredCredit(player1, amount, "morning");
    expect(await cbdc.balanceOf(player1)).to.equal(amount);
    await cbdc.connect(player1Signer).approve(transactionMorningPlayer1.address, amount);
    await icf.connect(deployer).obtainUnsecuredCredit(player2, amount, "morning");
    expect(await cbdc.balanceOf(player2)).to.equal(amount);
    await cbdc.connect(player2Signer).approve(transactionMorningPlayer2.address, amount);

    // settle morning transactions
    await system.settleTransaction(transactionMorningPlayer1.address);
    await system.settleTransaction(transactionMorningPlayer2.address);
    expect(await cbdc.balanceOf(player1)).to.equal(amount);
    expect(await cbdc.balanceOf(player2)).to.equal(amount);
    
    // return excess liquidity to ICF
    await cbdc.connect(player1Signer).approve(icf.address, amount);
    let response = await icf.settleUnsecuredCredit(player1, amount, "morning");
    let receipt = await response.wait();
    let event = receipt.events.find(event => event.event === "FeeIncurred");
    console.log("Player 1 Unsecured fee incurred: " + event.args[1].toString());
    expect(await cbdc.balanceOf(player1)).to.equal(0);
    await cbdc.connect(player2Signer).approve(icf.address, amount);
    response = await icf.settleUnsecuredCredit(player2, amount, "morning");
    receipt = await response.wait();
    event = receipt.events.find(event => event.event === "FeeIncurred");
    console.log("Player 2 Unsecured fee incurred: " + event.args[1].toString());
    expect(await cbdc.balanceOf(player2)).to.equal(0);

    await system.nextPeriod();

    // deploy and link afternoon transactions
    const TransactionAfternoonPlayer1 = await ethers.getContractFactory("TransactionContract", deployer);
    const transactionAfternoonPlayer1 = await TransactionAfternoonPlayer1.deploy(
        cbdc.address, //CBDC contract address
        player1, // payor address
        player2, // recipient address
        amount, // amount
        "afternoon"// creation period
    );
    await transactionAfternoonPlayer1.deployed();
    await system.loadTransactionContract(transactionAfternoonPlayer1.address);

    // obtain afternoon intraday credit
    await icf.connect(deployer).obtainUnsecuredCredit(player1, amount, "afternoon");
    expect(await cbdc.balanceOf(player1)).to.equal(amount);
    await cbdc.connect(player1Signer).approve(transactionAfternoonPlayer1.address, amount);

    // settle afternoon transaction
    await system.settleTransaction(transactionAfternoonPlayer1.address);
    expect(await cbdc.balanceOf(player1)).to.equal(0);
    expect(await cbdc.balanceOf(player2)).to.equal(amount);


    // rebalance
    await cbdc.connect(player2Signer).approve(system.address, amount);
    await cbdc.connect(player1Signer).approve(system.address, amount);
    await system.eodRebalance();
    expect(await cbdc.balanceOf(player1)).to.equal(amount);
    expect(await cbdc.balanceOf(player2)).to.equal(0);
    
    let player1Outstanding = await icf.callStatic.calculateOutstanding(player1);
    if (player1Outstanding > 0) {
      await cbdc.connect(player1Signer).approve(icf.address, amount);
      response = await icf.settleOutstanding(player1, "afternoon");
      receipt = await response.wait();
      event = receipt.events.find(event => event.event === "FeeIncurred");
      console.log("Player 1 fee incurred: " + event.args[1].toString());
    }
    let player2Outstanding = await icf.callStatic.calculateOutstanding(player2);
    if (player2Outstanding > 0) {
      await cbdc.connect(player2Signer).approve(icf.address, amount);
      response = await icf.settleOutstanding(player2, "afternoon");
      receipt = await response.wait();
      event = receipt.events.find(event => event.event === "FeeIncurred");
      console.log("Player 2 fee incurred: " + event.args[1].toString());
    }
    expect(await cbdc.balanceOf(player1)).to.equal(0);

    await system.nextPeriod();
  });

  it("test ICF outstanding", async function () {
    const [deployer] = await ethers.getSigners(); 
    const player1 = "0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c";
    const player1Signer = await ethers.getSigner(player1);
    const player2 = "0x14723A09ACff6D2A60DcdF7aA4AFf308FDDC160C";
    const player2Signer = await ethers.getSigner(player2);
    const amount = 100;
    const collateralOpportunityRate = 1;
    const claimBackedRate = 0;
    const unsecuredRate = 3;

    const CBDC = await ethers.getContractFactory("CBDC", deployer);
    const cbdc = await CBDC.deploy();
    await cbdc.deployed();
    const SafeSecurity = await ethers.getContractFactory("SafeSecurity", deployer);
    const safeSecurity = await SafeSecurity.deploy();
    await safeSecurity.deployed();
    const ICF = await ethers.getContractFactory("ICF", deployer);
    const icf = await ICF.deploy(
        collateralOpportunityRate,
        claimBackedRate,
        unsecuredRate,
        safeSecurity.address,
        cbdc.address
    );
    await icf.deployed();
    await cbdc.transferOwnership(icf.address);

    await icf.connect(deployer).obtainUnsecuredCredit(player1, amount, "morning");
    expect(await cbdc.balanceOf(player1)).to.equal(amount);

    expect(await icf.callStatic.calculateOutstanding(player1)).to.equal(amount);
  });

  it("test settle ICF oustanding", async function () {
    const [deployer] = await ethers.getSigners(); 
    const player1 = "0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c";
    const player1Signer = await ethers.getSigner(player1);
    const player2 = "0x14723A09ACff6D2A60DcdF7aA4AFf308FDDC160C";
    const player2Signer = await ethers.getSigner(player2);
    const amount = 100;
    const collateralOpportunityRate = 1;
    const claimBackedRate = 0;
    const unsecuredRate = 3;

    const CBDC = await ethers.getContractFactory("CBDC", deployer);
    const cbdc = await CBDC.deploy();
    await cbdc.deployed();
    const SafeSecurity = await ethers.getContractFactory("SafeSecurity", deployer);
    const safeSecurity = await SafeSecurity.deploy();
    await safeSecurity.deployed();
    const ICF = await ethers.getContractFactory("ICF", deployer);
    const icf = await ICF.deploy(
        collateralOpportunityRate,
        claimBackedRate,
        unsecuredRate,
        safeSecurity.address,
        cbdc.address
    );
    await icf.deployed();
    await cbdc.transferOwnership(icf.address);

    await icf.connect(deployer).obtainUnsecuredCredit(player1, amount, "morning");
    expect(await cbdc.balanceOf(player1)).to.equal(amount);

    await cbdc.connect(player1Signer).approve(icf.address, amount);
    await icf.settleOutstanding(player1, "afternoon");

    expect(await icf.callStatic.calculateOutstanding(player1)).to.equal(0);
  });

  it("test transaction cancelation", async function () {
    const [deployer] = await ethers.getSigners(); 
    const player1 = "0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c";
    const player1Signer = await ethers.getSigner(player1);
    const player2 = "0x14723A09ACff6D2A60DcdF7aA4AFf308FDDC160C";
    const player2Signer = await ethers.getSigner(player2);
    const amount = 100;
    const collateralOpportunityRate = 1;
    const claimBackedRate = 0;
    const unsecuredRate = 3;
    const delayCost = 0;
    const additionalDelayCost = 0;

    // deploy contracts
    const CBDC = await ethers.getContractFactory("CBDC", deployer);
    const cbdc = await CBDC.deploy();
    await cbdc.deployed();
    const SafeSecurity = await ethers.getContractFactory("SafeSecurity", deployer);
    const safeSecurity = await SafeSecurity.deploy();
    await safeSecurity.deployed();
    const ICF = await ethers.getContractFactory("ICF", deployer);
    const icf = await ICF.deploy(
        collateralOpportunityRate,
        claimBackedRate,
        unsecuredRate,
        safeSecurity.address,
        cbdc.address
    );
    await icf.deployed();
    const System = await ethers.getContractFactory("System", deployer);
    const system = await System.deploy(
        player1,
        player2,
        icf.address,
        cbdc.address,
        delayCost,
        additionalDelayCost
    );
    await system.deployed();

    // transfer ownership of CBDC contract to ICF
    await cbdc.transferOwnership(icf.address);

    // deploy and link morning transactions
    const Transaction = await ethers.getContractFactory("TransactionContract", deployer);
    const transaction = await Transaction.deploy(
        cbdc.address, //CBDC contract address
        player1, // payor address
        player2, // recipient address
        amount, // amount
        "morning"// creation period
    );
    await transaction.deployed();
    await system.loadTransactionContract(transaction.address);

    let transactionDetails = await transaction.transaction();
    expect(transactionDetails[6]).to.be.false;

    await system.nextPeriod();
    await system.nextPeriod();
    await system.nextPeriod();
    transactionDetails = await transaction.transaction();
    expect(transactionDetails[6]).to.be.true;
  });
  it("test fee calculation", async function () {
    const [deployer] = await ethers.getSigners(); 
    const player1 = "0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c";
    const player1Signer = await ethers.getSigner(player1);
    const player2 = "0x14723A09ACff6D2A60DcdF7aA4AFf308FDDC160C";
    const amount = 1000;
    const collateralOpportunityRate = 11;
    const claimBackedRate = 0;
    const unsecuredRate = 30;
    const delayCost = 0;
    const additionalDelayCost = 0;

     // deploy contracts
    const CBDC = await ethers.getContractFactory("CBDC", deployer);
    const cbdc = await CBDC.deploy();
    await cbdc.deployed();
    const SafeSecurity = await ethers.getContractFactory("SafeSecurity", deployer);
    const safeSecurity = await SafeSecurity.deploy();
    await safeSecurity.deployed();
    const ICF = await ethers.getContractFactory("ICF", deployer);
    const icf = await ICF.deploy(
        collateralOpportunityRate,
        claimBackedRate,
        unsecuredRate,
        safeSecurity.address,
        cbdc.address
    );
    await icf.deployed();

    // transfer ownership of CBDC contract to ICF
    await cbdc.transferOwnership(icf.address);

    // expect(await icf.calculatePenalty("morning", "morning", 1000, 30)).to.equal(300);

    // deploy morning transactions
    const Transaction = await ethers.getContractFactory("TransactionContract", deployer);
    const transaction = await Transaction.deploy(
        cbdc.address, //CBDC contract address
        player1, // payor address
        player2, // recipient address
        amount, // amount
        "morning"// creation period
    );
    await transaction.deployed();

    await icf.obtainUnsecuredCredit(player1, amount, "morning");

    await cbdc.connect(player1Signer).approve(icf.address, amount);

    response = await icf.settleOutstanding(player1, "morning");
    receipt = await response.wait();
    event = receipt.events.find(event => event.event === "FeeIncurred");
    expect(parseInt(event.args[1], 10)).to.equal(300);
  });
});
