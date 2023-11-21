import json

with open('./build/contracts/CBDC.json') as json_file:
    contents = json.load(json_file)
    print(contents['abi'])