import json
from web3 import Web3
from solcx import compile_standard, install_solc
from dotenv import load_dotenv
install_solc('0.8.20')

load_dotenv()

ganache_url = 'http://127.0.0.1:7545'
w3 = Web3(Web3.HTTPProvider(ganache_url))
chain_id = 5777

account1 = '0xA155273c5f0Eeb7B84ce014705b9d43E75aE72f4'
account1_pk = '7304e9f54e8f6234aea3653e43d928b3a51231998bd345fbc67329f9df298e7d'
account2 = '0x83433BbAb285a6b0C9C96B4Bb5a21430ACfd92e0'
account3 = '0xA137f67Fd6943f72065CC42Ced9eD786E5547339'

with open('./contracts/CBDC.sol', 'r') as file:
    cbdc_file = file.read()

compiled_cbdc = compile_standard (
    {
        "language": "Solidity",
        "sources": {"./contracts/CBDC.sol": {"content": cbdc_file}
                    # "./node_modules/@openzeppelin/contracts/token/ERC20/ERC20.sol": {"content": open('./node_modules/@openzeppelin/contracts/token/ERC20/ERC20.sol', 'r').read()},
                    # "./node_modules/@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol": {"content": open('./node_modules/@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol', 'r').read()},
                    # "./node_modules/@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol": {"content": open('./node_modules/@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol', 'r').read()},
                    # "./node_modules/@openzeppelin/contracts/access/Ownable.sol": {"content": open('./node_modules/@openzeppelin/contracts/access/Ownable.sol', 'r').read()}
                    },
        "settings": {
            "outputSelection": {
                "*": {
                    "*": ["abi", "metadata", "evm.bytecode", "evm.bytecode.sourceMap"]
                }
            }
        },
    },
    solc_version="0.8.20",
)

bytecode = compiled_cbdc['contracts']['./contracts/CBDC.sol']['CBDC']['evm']['bytecode']['object']
abi = json.loads(compiled_cbdc['contracts']['./contracts/CBDC.sol']['CBDC']['metadata'])['output']['abi']
# with open('./build/contracts/CBDC.json') as json_file:
#     contents = json.load(json_file)
#     bytecode = contents['bytecode']
#     abi = contents['abi']

cbdc_contract = w3.eth.contract(abi=abi, bytecode=bytecode)

nonce = w3.eth.get_transaction_count(account1)

transaction = cbdc_contract.constructor().build_transaction({
    'gasPrice': w3.eth.gas_price,
    'from': account1,
    'nonce': nonce
})

signed_txn = w3.eth.account.sign_transaction(transaction, private_key=account1_pk)
tx_hash = w3.eth.sendRawTransaction(signed_txn.rawTransaction)
tx_receipt = w3.eth.wait_for_transaction_receipt(tx_hash)