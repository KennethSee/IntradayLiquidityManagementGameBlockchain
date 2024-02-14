const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Simulation", function() {
    async function simulate(
        player1, 
        player2, 
        amount, 
        collateralOpportunityRate, 
        claimBackedRate, 
        unsecuredRate, 
        delayCost, 
        additionalDelayCost, 
        alpha,
        player1SolvencyShock,
        player2SolvencyShock,
        player1HasCollateral,
        player2HasCollateral,
        player1HasMorningTxn,
        player2HasMorningTxn,
        player1HasAfternoonTxn,
        player2HasAfternoonTxn,
        player1Type,
        player2Type
        ) {
        const [deployer] = await ethers.getSigners(); 
        const player1Signer = await ethers.getSigner(player1);
        const player2Signer = await ethers.getSigner(player2);
        let player1TxnCompleted = 0;
        let player2TxnCompleted = 0;

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

        // transfer safe security for collateral to player if they should have it
        if (player1HasCollateral) {
            await safeSecurity.connect(deployer).mint(player1, amount * 4);
        }
        if (player2HasCollateral) {
            await safeSecurity.connect(deployer).mint(player2, amount * 4);
        }

        // transfer ownership of CBDC contract to ICF
        await cbdc.transferOwnership(icf.address);

        // morning period
        // create and load morning transactions
        let transactionMorningPlayer1;
        let transactionMorningPlayer2;
        if (player1HasMorningTxn) {
            const TransactionMorningPlayer1 = await ethers.getContractFactory("TransactionContract", deployer);
            transactionMorningPlayer1 = await TransactionMorningPlayer1.deploy(
                cbdc.address, //CBDC contract address
                player1, // payor address
                player2, // recipient address
                amount, // amount
                "morning"// creation period
            );
            await transactionMorningPlayer1.deployed();
            await system.loadTransactionContract(transactionMorningPlayer1.address);
        }
        if (player2HasMorningTxn) {
            const TransactionMorningPlayer2 = await ethers.getContractFactory("TransactionContract", deployer);
            transactionMorningPlayer2 = await TransactionMorningPlayer2.deploy(
                cbdc.address, //CBDC contract address
                player2, // payor address
                player1, // recipient address
                amount, // amount
                "morning"// creation period
            );
            await transactionMorningPlayer2.deployed();
            await system.loadTransactionContract(transactionMorningPlayer2.address);
        }

        // Obtain necessary credit from ICF
        if (player1HasMorningTxn && (player1Type == "morning")) {
            let creditSelection = await choose_credit(player1HasCollateral, player2HasMorningTxn, collateralOpportunityRate, claimBackedRate, unsecuredRate);
            if (creditSelection == "collateral") {
                await safeSecurity.connect(player1Signer).approve(icf.address, amount);
                await icf.connect(deployer).obtainCollateralizedCredit(player1, amount, "morning");
            }
            else if (creditSelection == "claim") {
                await icf.connect(deployer).obtainClaimBackedCredit(player1, amount, transactionMorningPlayer2.address, "morning");
            }
            else {
                await icf.connect(deployer).obtainUnsecuredCredit(player1, amount, "morning");
            }
        }
        if (player2HasMorningTxn && (player2Type == "morning")) {
            let creditSelection = await choose_credit(player2HasCollateral, player1HasMorningTxn, collateralOpportunityRate, claimBackedRate, unsecuredRate);
            if (creditSelection == "collateral") {
                await safeSecurity.connect(player2Signer).approve(icf.address, amount);
                await icf.connect(deployer).obtainCollateralizedCredit(player2, amount, "morning");
            }
            else if (creditSelection == "claim") {
                await icf.connect(deployer).obtainClaimBackedCredit(player2, amount, transactionMorningPlayer1.address, "morning");
            }
            else {
                await icf.connect(deployer).obtainUnsecuredCredit(player2, amount, "morning");
            }
        }

        // settle morning transactions if player type warrants it
        if (player1HasMorningTxn && (player1Type == "morning")) {
            await cbdc.connect(player1Signer).approve(transactionMorningPlayer1.address, amount);
            await system.settleTransaction(transactionMorningPlayer1.address);
            player1TxnCompleted += 1;
        }
        if (player2HasMorningTxn && (player2Type == "morning")) {
            await cbdc.connect(player2Signer).approve(transactionMorningPlayer2.address, amount);
            await system.settleTransaction(transactionMorningPlayer2.address);
            player2TxnCompleted += 1;
        }

        // return outstanding credit to ICF if possible
        let response;
        let receipt;
        let event;
        let player1Fee = 0;
        let player1ICFOutstanding = await icf.callStatic.calculateOutstanding(player1);
        if (((await cbdc.balanceOf(player1)) >= player1ICFOutstanding) && player1HasMorningTxn && (player1Type == "morning")) {
            await cbdc.connect(player1Signer).approve(icf.address, amount);
            response = await icf.settleOutstanding(player1, "morning");
            receipt = await response.wait();
            event = receipt.events.find(event => event.event === "FeeIncurred");
            // console.log(receipt);
            player1Fee += parseInt(event.args[1], 10);
            // console.log('Fee...' + player1Fee.toString());
            // console.log((await cbdc.balanceOf(player1)).toString());
        }
        let player2Fee = 0;
        let player2ICFOutstanding = await icf.callStatic.calculateOutstanding(player2);
        if (((await cbdc.balanceOf(player2)) >= player2ICFOutstanding) && player2HasMorningTxn && (player2Type == "morning")) {
            await cbdc.connect(player2Signer).approve(icf.address, amount);
            response = await icf.settleOutstanding(player2, "morning");
            receipt = await response.wait();
            event = receipt.events.find(event => event.event === "FeeIncurred");
            player2Fee += parseInt(event.args[1], 10);
        }

        await system.nextPeriod();

        // afternoon period
        // create and load afternoon transactions
        let transactionAfternoonPlayer1;
        let transactionAfternoonPlayer2;
        if (player1HasAfternoonTxn) {
            const TransactionAfternoonPlayer1 = await ethers.getContractFactory("TransactionContract", deployer);
            transactionAfternoonPlayer1 = await TransactionAfternoonPlayer1.deploy(
                cbdc.address, //CBDC contract address
                player1, // payor address
                player2, // recipient address
                amount, // amount
                "afternoon"// creation period
            );
            await transactionAfternoonPlayer1.deployed();
            await system.loadTransactionContract(transactionAfternoonPlayer1.address);
        }
        if (player2HasAfternoonTxn) {
            const TransactionAfternoonPlayer2 = await ethers.getContractFactory("TransactionContract", deployer);
            transactionAfternoonPlayer2 = await TransactionAfternoonPlayer2.deploy(
                cbdc.address, //CBDC contract address
                player2, // payor address
                player1, // recipient address
                amount, // amount
                "afternoon"// creation period
            );
            await transactionAfternoonPlayer2.deployed();
            await system.loadTransactionContract(transactionAfternoonPlayer2.address);
        }

        // Switch out ICF credit
        let player1AfternoonCreditOutstanding = await icf.callStatic.calculateOutstanding(player1);
        if ((player1AfternoonCreditOutstanding > 0) && ((await icf.callStatic.calculateClaimBackedOutstanding(player1)==0))) {
            let creditToSwitchOut;
            if ((await icf.callStatic.calculateCollateralizedOutstanding(player1)) > 0) {
                creditToSwitchOut = 'collateral';
            }
            else {
                creditToSwitchOut = 'unsecured';
            }

            let creditSelection = await choose_credit(player1HasCollateral, player2HasAfternoonTxn, collateralOpportunityRate, claimBackedRate, unsecuredRate);
            if (creditSelection == "collateral") {
                await safeSecurity.connect(player1Signer).approve(icf.address, player1AfternoonCreditOutstanding);
                await icf.connect(deployer).obtainCollateralizedCredit(player1, player1AfternoonCreditOutstanding, "afternoon");
            }
            else if (creditSelection == "claim") {
                await icf.connect(deployer).obtainClaimBackedCredit(player1, player1AfternoonCreditOutstanding, transactionAfternoonPlayer2.address, "afternoon");
            }
            else {
                await icf.connect(deployer).obtainUnsecuredCredit(player1, player1AfternoonCreditOutstanding, "afternoon");
            }

            await cbdc.connect(player1Signer).approve(icf.address, player1AfternoonCreditOutstanding);
            if (creditToSwitchOut == "collateral") {
                response = await icf.settleCollateralizedCredit(player1, player1AfternoonCreditOutstanding, "morning");
            }
            else {
                response = await icf.settleUnsecuredCredit(player1, player1AfternoonCreditOutstanding, "morning");
            }
            receipt = await response.wait();
            event = receipt.events.find(event => event.event === "FeeIncurred");
            player1Fee += parseInt(event.args[1], 10);
        }
        


        // Address unsettled morning transactions first
        if (player1HasMorningTxn && (player1Type == "afternoon")) {
            if ((await cbdc.balanceOf(player1)) >= amount) {
                await cbdc.connect(player1Signer).approve(transactionMorningPlayer1.address, amount);
                await system.settleTransaction(transactionMorningPlayer1.address);
                player1TxnCompleted += 1;
            }
            else if (!player1SolvencyShock) {
                let player2HasMorningTxnOpen = false;
                let player2HasAfternoonTxnOpen = false;
                if (player2HasMorningTxn) {
                    player2HasMorningTxnOpen = await transactionMorningPlayer2.isTxnOpen();
                }
                if (player2HasAfternoonTxn) {
                    player2HasAfternoonTxnOpen = (await transactionAfternoonPlayer2.isTxnOpen()) && !(await icf.checkIfTxnHeld(player1, transactionAfternoonPlayer2.address));
                }
                // console.log(!(await icf.checkIfTxnHeld(player1, transactionAfternoonPlayer2.address)));
                let creditSelection = await choose_credit(player1HasCollateral, player2HasMorningTxnOpen || player2HasAfternoonTxnOpen, collateralOpportunityRate, claimBackedRate, unsecuredRate);
                if (creditSelection == "collateral") {
                    await safeSecurity.connect(player1Signer).approve(icf.address, amount);
                    await icf.connect(deployer).obtainCollateralizedCredit(player1, amount, "afternoon");
                }
                else if (creditSelection == "claim") {
                    if (player2HasMorningTxnOpen) {
                        await icf.connect(deployer).obtainClaimBackedCredit(player1, amount, transactionMorningPlayer2.address, "afternoon");
                    }
                    else {
                        await icf.connect(deployer).obtainClaimBackedCredit(player1, amount, transactionAfternoonPlayer2.address, "afternoon");
                    }
                }
                else {
                    await icf.connect(deployer).obtainUnsecuredCredit(player1, amount, "afternoon");
                }
                // console.log("Player 1 obtained credit for morning transaction"); // logging
            }
        }
        if (player2HasMorningTxn && (player2Type == "afternoon")) {
            if ((await cbdc.balanceOf(player2)) >= amount) {
                await cbdc.connect(player2Signer).approve(transactionMorningPlayer2.address, amount);
                await system.settleTransaction(transactionMorningPlayer2.address);
                player2TxnCompleted += 1;
            }
            else if (!player2SolvencyShock) {
                let player1HasMorningTxnOpen = false;
                let player1HasAfternoonTxnOpen = false;
                if (player1HasMorningTxn) {
                    player1HasMorningTxnOpen = await transactionMorningPlayer1.isTxnOpen();
                }
                if (player1HasAfternoonTxn) {
                    player1HasAfternoonTxnOpen = await transactionAfternoonPlayer1.isTxnOpen();
                }
                let creditSelection = await choose_credit(player2HasCollateral, player1HasMorningTxnOpen || player1HasAfternoonTxnOpen, collateralOpportunityRate, claimBackedRate, unsecuredRate);
                if (creditSelection == "collateral") {
                    await safeSecurity.connect(player2Signer).approve(icf.address, amount);
                    await icf.connect(deployer).obtainCollateralizedCredit(player2, amount, "afternoon");
                }
                else if (creditSelection == "claim") {
                    if (player1HasMorningTxnOpen) {
                        await icf.connect(deployer).obtainClaimBackedCredit(player2, amount, transactionMorningPlayer1.address, "afternoon");
                    }
                    else {
                        await icf.connect(deployer).obtainClaimBackedCredit(player2, amount, transactionAfternoonPlayer1.address, "afternoon");
                    }
                }
                else {
                    await icf.connect(deployer).obtainUnsecuredCredit(player2, amount, "afternoon");
                }
                // console.log("Player 2 obtained credit for morning transaction"); // logging
            }
        }
        if (player1HasMorningTxn && (player1Type == "afternoon") && !player1SolvencyShock) {
            if (await transactionMorningPlayer1.isTxnOpen()) {
                // console.log('Player 1 settling morning transaction and has ' + (await cbdc.balanceOf(player1)).toString());
                await cbdc.connect(player1Signer).approve(transactionMorningPlayer1.address, amount);
                await system.settleTransaction(transactionMorningPlayer1.address);
                player1TxnCompleted += 1;
            }
        }
        if (player2HasMorningTxn && (player2Type == "afternoon") && !player2SolvencyShock) {
            if (await transactionMorningPlayer2.isTxnOpen()) {
                // console.log('Player 2 settling morning transaction and has ' + (await cbdc.balanceOf(player2)).toString());
                await cbdc.connect(player2Signer).approve(transactionMorningPlayer2.address, amount);
                await system.settleTransaction(transactionMorningPlayer2.address);
                player2TxnCompleted += 1;
            }
        }

        // handle afternoon transactions
        if (player1HasAfternoonTxn) {
            if ((await cbdc.balanceOf(player1)) >= amount) {
                await cbdc.connect(player1Signer).approve(transactionAfternoonPlayer1.address, amount);
                await system.settleTransaction(transactionAfternoonPlayer1.address);
                player1TxnCompleted += 1;
            }
            else if (!player1SolvencyShock) {
                let player2HasMorningTxnOpen = false;
                let player2HasAfternoonTxnOpen = false;
                if (player2HasMorningTxn) {
                    player2HasMorningTxnOpen = (await transactionMorningPlayer2.isTxnOpen()) && !(await icf.checkIfTxnHeld(player1, transactionMorningPlayer2.address));
                }
                if (player2HasAfternoonTxn) {
                    player2HasAfternoonTxnOpen = (await transactionAfternoonPlayer2.isTxnOpen()) && !(await icf.checkIfTxnHeld(player1, transactionAfternoonPlayer2.address));
                }
                let creditSelection = await choose_credit(player1HasCollateral, player2HasMorningTxnOpen || player2HasAfternoonTxnOpen, collateralOpportunityRate, claimBackedRate, unsecuredRate);
                if (creditSelection == "collateral") {
                    await safeSecurity.connect(player1Signer).approve(icf.address, amount);
                    await icf.connect(deployer).obtainCollateralizedCredit(player1, amount, "afternoon");
                }
                else if (creditSelection == "claim") {
                    if (player2HasMorningTxnOpen) {
                        await icf.connect(deployer).obtainClaimBackedCredit(player1, amount, transactionMorningPlayer2.address, "afternoon");
                    }
                    else {
                        await icf.connect(deployer).obtainClaimBackedCredit(player1, amount, transactionAfternoonPlayer2.address, "afternoon");
                    }
                }
                else {
                    await icf.connect(deployer).obtainUnsecuredCredit(player1, amount, "afternoon");
                }
                // console.log("Player 1 obtained credit for afternoon transaction"); // logging
            }
        }
        if (player2HasAfternoonTxn) {
            if ((await cbdc.balanceOf(player2)) >= amount) {
                await cbdc.connect(player2Signer).approve(transactionAfternoonPlayer2.address, amount);
                await system.settleTransaction(transactionAfternoonPlayer2.address);
                player2TxnCompleted += 1;
            }
            else if (!player2SolvencyShock) {
                let player1HasMorningTxnOpen = false;
                let player1HasAfternoonTxnOpen = false;
                if (player1HasMorningTxn) {
                    player1HasMorningTxnOpen = (await transactionMorningPlayer1.isTxnOpen()) && !(await icf.checkIfTxnHeld(player2, transactionMorningPlayer1.address));
                }
                if (player1HasAfternoonTxn) {
                    player1HasAfternoonTxnOpen = (await transactionAfternoonPlayer1.isTxnOpen()) && !(await icf.checkIfTxnHeld(player2, transactionAfternoonPlayer1.address));
                }
                let creditSelection = await choose_credit(player2HasCollateral, player1HasMorningTxnOpen || player1HasAfternoonTxnOpen, collateralOpportunityRate, claimBackedRate, unsecuredRate);
                if (creditSelection == "collateral") {
                    await safeSecurity.connect(player2Signer).approve(icf.address, amount);
                    await icf.connect(deployer).obtainCollateralizedCredit(player2, amount, "afternoon");
                }
                else if (creditSelection == "claim") {
                    if (player1HasMorningTxnOpen) {
                        await icf.connect(deployer).obtainClaimBackedCredit(player2, amount, transactionMorningPlayer1.address, "afternoon");
                    }
                    else {
                        await icf.connect(deployer).obtainClaimBackedCredit(player2, amount, transactionAfternoonPlayer1.address, "afternoon");
                    }
                }
                else {
                    await icf.connect(deployer).obtainUnsecuredCredit(player2, amount, "afternoon");
                }
                // console.log("Player 2 obtained credit for afternoon transaction"); // logging
            }
        }
        if (player1HasAfternoonTxn && !player1SolvencyShock) {
            if (await transactionAfternoonPlayer1.isTxnOpen()) {
                // console.log('Player 1 settling afternoon transaction and has ' + (await cbdc.balanceOf(player1)).toString());
                await cbdc.connect(player1Signer).approve(transactionAfternoonPlayer1.address, amount);
                await system.settleTransaction(transactionAfternoonPlayer1.address);
                player1TxnCompleted += 1;
            }
        }
        if (player2HasAfternoonTxn && !player2SolvencyShock) {
            if (await transactionAfternoonPlayer2.isTxnOpen()) {
                // console.log('Player 2 settling afternoon transaction and has ' + (await cbdc.balanceOf(player2)).toString());
                await cbdc.connect(player2Signer).approve(transactionAfternoonPlayer2.address, amount);
                await system.settleTransaction(transactionAfternoonPlayer2.address);
                player2TxnCompleted += 1;
            }
        }

        // rebalance
        await cbdc.connect(player2Signer).approve(system.address, amount * 2);
        await cbdc.connect(player1Signer).approve(system.address, amount * 2);
        await system.eodRebalance();

        // return to ICF
        if (!player1SolvencyShock) {
            player1ICFOutstanding = await icf.callStatic.calculateOutstanding(player1);
            if (((await cbdc.balanceOf(player1)) >= player1ICFOutstanding) && player1HasMorningTxn && (player1Type == "afternoon") && (player1ICFOutstanding > 0)) {
                await cbdc.connect(player1Signer).approve(icf.address, amount);
                response = await icf.settleOutstanding(player1, "afternoon");
                receipt = await response.wait();
                event = receipt.events.find(event => event.event === "FeeIncurred");
                player1Fee += parseInt(event.args[1], 10);
            }
            player1ICFOutstanding = await icf.callStatic.calculateOutstanding(player1);
            if (((await cbdc.balanceOf(player1)) >= player1ICFOutstanding) && (player1ICFOutstanding > 0)) {
                await cbdc.connect(player1Signer).approve(icf.address, amount);
                response = await icf.settleOutstanding(player1, "afternoon");
                receipt = await response.wait();
                event = receipt.events.find(event => event.event === "FeeIncurred");
                player1Fee += parseInt(event.args[1], 10);
            }
        }
        player2ICFOutstanding = await icf.callStatic.calculateOutstanding(player2);
        if (!player2SolvencyShock) {
            if (((await cbdc.balanceOf(player2)) >= player2ICFOutstanding) && player2HasMorningTxn && (player2Type == "afternoon") && (player2ICFOutstanding > 0)) {
                await cbdc.connect(player2Signer).approve(icf.address, amount);
                response = await icf.settleOutstanding(player2, "afternoon");
                receipt = await response.wait();
                event = receipt.events.find(event => event.event === "FeeIncurred");
                player2Fee += parseInt(event.args[1], 10);
            }
            if (((await cbdc.balanceOf(player2)) >= player2ICFOutstanding) && (player2ICFOutstanding > 0)) {
                await cbdc.connect(player2Signer).approve(icf.address, amount);
                response = await icf.settleOutstanding(player2, "afternoon");
                receipt = await response.wait();
                event = receipt.events.find(event => event.event === "FeeIncurred");
                player2Fee += parseInt(event.args[1], 10);
            }
        }

        await system.nextPeriod();
        await system.nextPeriod();

        let player1DelayCost = parseInt(await system.getNetDelayCost(player1), 10);
        let player2DelayCost = parseInt(await system.getNetDelayCost(player2), 10);

        let player1Payoff = player1TxnCompleted * alpha - player1Fee - player1DelayCost;
        let player2Payoff = player2TxnCompleted * alpha - player2Fee - player2DelayCost;

        // console.log(player1Fee.toString());
        // console.log(player1DelayCost.toString());
        console.log("Payoff: " + player1Payoff.toString());
    }

    async function randomize(probability) {
        let random_num = Math.random();
        if (random_num <= probability) {
            return true;
        }
        else {
            return false;
        }
    }

    async function choose_credit(hasCollateral, hasIncomingTransaction, collateralOpportunityRate, claimBackedRate, unsecuredRate) {
        let minRate = Math.min(collateralOpportunityRate, claimBackedRate, unsecuredRate);
        if (hasCollateral && (collateralOpportunityRate == minRate)) {
            return "collateral";
        }
        else if (hasIncomingTransaction && (claimBackedRate == minRate)) {
            return "claim";
        }
        else if (hasCollateral && (collateralOpportunityRate < unsecuredRate)) {
            return "collateral";
        }
        else if (hasIncomingTransaction && (claimBackedRate < unsecuredRate)) {
            return "claim";
        }
        else {
            return "unsecured";
        }
    }

    it("Full Game", async function () {
        const player1 = "0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c";
        const player2 = "0x14723A09ACff6D2A60DcdF7aA4AFf308FDDC160C";
        const amount = 1000;
        
        const claimBackedRate = 0;
        const unsecuredRate = 15;
        const alpha = amount;

        const probDefault = 0.1;
        const probHasCollateral = 1;//0.8;
        const probMorningTxn = 0.8;
        const probAfternoonTxn = 0.8;

        let player2Type;
        if (await randomize(0.5)) {
            player2Type = "morning";
        }
        else {
            player2Type = "afternoon";
        }

        // varying elements
        let collateralOpportunityRate;
        let delayCost;
        let additionalDelayCost;
        let player1Type;

        let varying = new Array(13);
        varying[0] = new Array(0.0, 0.1, 0.1);
        varying[1] = new Array(0.0, 0.1, 0.2);
        varying[2] = new Array(0.0, 0.2, 0.1);
        varying[3] = new Array(0.1, 0.0, 0.1);
        varying[4] = new Array(0.1, 0.0, 0.2);
        varying[5] = new Array(0.1, 0.1, 0.0);
        varying[6] = new Array(0.1, 0.1, 0.1);
        varying[7] = new Array(0.1, 0.1, 0.2);
        varying[8] = new Array(0.1, 0.2, 0.0);
        varying[9] = new Array(0.1, 0.2, 0.1);
        varying[10] = new Array(0.2, 0.0, 0.1);
        varying[11] = new Array(0.2, 0.1, 0.0);
        varying[12] = new Array(0.2, 0.1, 0.1);
        // let varying = new Array(2);
        // varying[0] = new Array(0.3, 0.1, 0.1);
        // varying[1] = new Array(0.2, 0.2, 0.2);

        // chance elements
        const player1SolvencyShock = await randomize(probDefault);
        const player2SolvencyShock = await randomize(probDefault);
        const player1HasCollateral = await randomize(probHasCollateral);
        const player2HasCollateral = await randomize(probHasCollateral);
        const player1HasMorningTxn = await randomize(probMorningTxn);
        const player2HasMorningTxn = await randomize(probMorningTxn);
        const player1HasAfternoonTxn = await randomize(probAfternoonTxn);
        const player2HasAfternoonTxn = await randomize(probAfternoonTxn);


        // morning strategies
        player1Type = "morning";
        for (let i=0; i < varying.length; i++){
            collateralOpportunityRate = varying[i][0] * 100;
            delayCost = varying[i][1] * 100;
            additionalDelayCost = varying[i][2] * 100;
            console.log("Beginning simulation for morning strategy, " + varying[i][0].toString() + ", " + varying[i][1].toString() + ", " + varying[i][2].toString());
            await simulate(
                player1, 
                player2, 
                amount, 
                collateralOpportunityRate, 
                claimBackedRate, 
                unsecuredRate, 
                delayCost, 
                additionalDelayCost, 
                alpha,
                player1SolvencyShock,
                player2SolvencyShock,
                player1HasCollateral,
                player2HasCollateral,
                player1HasMorningTxn,
                player2HasMorningTxn,
                player1HasAfternoonTxn,
                player2HasAfternoonTxn,
                player1Type,
                player2Type
            );
        }
        // afternoon strategies
        player1Type = "afternoon";
        for (let i=0; i < varying.length; i++){
            collateralOpportunityRate = varying[i][0] * 100;
            delayCost = varying[i][1] * 100;
            additionalDelayCost = varying[i][2] * 100;
            console.log("Beginning simulation for afternoon strategy, " + varying[i][0].toString() + ", " + varying[i][1].toString() + ", " + varying[i][2].toString());
            await simulate(
                player1, 
                player2, 
                amount, 
                collateralOpportunityRate, 
                claimBackedRate, 
                unsecuredRate, 
                delayCost, 
                additionalDelayCost, 
                alpha,
                player1SolvencyShock,
                player2SolvencyShock,
                player1HasCollateral,
                player2HasCollateral,
                player1HasMorningTxn,
                player2HasMorningTxn,
                player1HasAfternoonTxn,
                player2HasAfternoonTxn,
                player1Type,
                player2Type
            );
        }

        console.log("Player 1 defaulted: " + player1SolvencyShock);
        console.log("Player 2 defaulted: " + player2SolvencyShock);
        console.log("Player 2 has morning transaction: " + player2HasMorningTxn)
        console.log("Player 2 strategy: " + player2Type);
    });
});
