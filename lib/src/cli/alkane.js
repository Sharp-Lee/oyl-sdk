"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.alkaneVerifyChain = exports.executeParallelChainMinting_CLI = exports.alkaneChainMint = exports.alkaneEstimateFee = exports.alkaneBatchExecute = exports.alkaneList = exports.alkanePreviewRemoveLiquidity = exports.alkaneGetAllPoolsDetails = exports.alkaneSimulate = exports.alkaneAddLiquidity = exports.alkaneCreatePool = exports.alkaneSend = exports.alkaneSwap = exports.alkaneRemoveLiquidity = exports.alkaneExecute = exports.alkaneTokenDeploy = exports.alkaneContractDeploy = exports.alkanesTrace = exports.AlkanesCommand = void 0;
const tslib_1 = require("tslib");
const commander_1 = require("commander");
const fs_extra_1 = tslib_1.__importDefault(require("fs-extra"));
const node_zlib_1 = require("node:zlib");
const util_1 = require("util");
const path_1 = tslib_1.__importDefault(require("path"));
const alkanes = tslib_1.__importStar(require("../alkanes/alkanes"));
const utxo = tslib_1.__importStar(require("../utxo"));
const wallet_1 = require("./wallet");
const contract_1 = require("../alkanes/contract");
const token_1 = require("../alkanes/token");
const proto_runestone_upgrade_1 = require("alkanes/lib/protorune/proto_runestone_upgrade");
const protostone_1 = require("alkanes/lib/protorune/protostone");
const bytes_1 = require("alkanes/lib/bytes");
const alkanes_1 = require("../rpclient/alkanes");
const protoruneruneid_1 = require("alkanes/lib/protorune/protoruneruneid");
const integer_1 = require("@magiceden-oss/runestone-lib/dist/src/integer");
const factory_1 = require("../amm/factory");
const pool_1 = require("../amm/pool");
const utils_1 = require("../shared/utils");
const chainMinting_1 = require("../alkanes/chainMinting");
const transactionBuilder_1 = require("../alkanes/transactionBuilder");
const chainVerification_1 = require("../alkanes/chainVerification");
/* @dev example call
  oyl alkane trace -params '{"txid":"e6561c7a8f80560c30a113c418bb56bde65694ac2b309a68549f35fdf2e785cb","vout":0}'

  Note the json format if you need to pass an object.
*/
class AlkanesCommand extends commander_1.Command {
    constructor(cmd) {
        super(cmd);
    }
    action(fn) {
        this.option('-s, --metashrew-rpc-url <url>', 'metashrew JSON-RPC override');
        return super.action(async (options) => {
            alkanes_1.metashrew.set(options.metashrewRpcUrl || null);
            return await fn(options);
        });
    }
}
exports.AlkanesCommand = AlkanesCommand;
exports.alkanesTrace = new AlkanesCommand('trace')
    .description('Returns data based on txid and vout of deployed alkane')
    .option('-p, --provider <provider>', 'provider to use to access the network.')
    .option('-params, --parameters <parameters>', 'parameters for the ord method you are calling.')
    .action(async (options) => {
    const wallet = new wallet_1.Wallet(options);
    const provider = wallet.provider;
    let isJson;
    isJson = JSON.parse(options.parameters);
    const { vout, txid } = isJson;
    console.log(JSON.stringify(await provider.alkanes.trace({
        vout,
        txid,
    })));
});
/* @dev example call
  oyl alkane new-contract -c ./src/cli/contracts/free_mint.wasm -data 3,77,100

  The free_mint.wasm contract is used as an example. This deploys to Reserve Number 77.

  To verify the factory contract was deployed, you can use the oyl alkane trace command
  using the returned txid and vout: 3

  Remember to genBlocks after sending transactions to the regtest chain!
*/
exports.alkaneContractDeploy = new AlkanesCommand('new-contract')
    .requiredOption('-data, --calldata <calldata>', 'op code + params to be used when deploying a contracts', (value, previous) => {
    const items = value.split(',');
    return previous ? previous.concat(items) : items;
}, [])
    .requiredOption('-c, --contract <contract>', 'Relative path to contract wasm file to deploy (e.g., "../alkanes/free_mint.wasm")')
    .option('-p, --provider <provider>', 'Network provider type (regtest, bitcoin)')
    .option('-feeRate, --feeRate <feeRate>', 'fee rate')
    .action(async (options) => {
    const wallet = new wallet_1.Wallet(options);
    const { accountUtxos } = await utxo.accountUtxos({
        account: wallet.account,
        provider: wallet.provider,
    });
    const contract = new Uint8Array(Array.from(await fs_extra_1.default.readFile(path_1.default.resolve(process.cwd(), options.contract))));
    const gzip = (0, util_1.promisify)(node_zlib_1.gzip);
    const payload = {
        body: await gzip(contract, { level: 9 }),
        cursed: false,
        tags: { contentType: '' },
    };
    const callData = [];
    for (let i = 0; i < options.calldata.length; i++) {
        callData.push(BigInt(options.calldata[i]));
    }
    const protostone = (0, proto_runestone_upgrade_1.encodeRunestoneProtostone)({
        protostones: [
            protostone_1.ProtoStone.message({
                protocolTag: 1n,
                edicts: [],
                pointer: 0,
                refundPointer: 0,
                calldata: (0, bytes_1.encipher)(callData),
            }),
        ],
    }).encodedRunestone;
    console.log(await (0, contract_1.contractDeployment)({
        protostone,
        payload,
        utxos: accountUtxos,
        feeRate: wallet.feeRate,
        account: wallet.account,
        signer: wallet.signer,
        provider: wallet.provider,
    }));
});
/* @dev example call
  oyl alkane new-token -pre 5000 -amount 1000 -c 100000 -name "OYL" -symbol "OL" -resNumber 77 -i ./src/cli/contracts/image.png
  
  The resNumber must be a resNumber for a deployed contract. In this case 77 is the resNumber for
  the free_mint.wasm contract and the options supplied are for the free_mint.wasm contract.

  The token will deploy to the next available [2, n] Alkane ID.

  To get information on the deployed token, you can use the oyl alkane trace command
  using the returned txid and vout: 4

  Remember to genBlocks after transactions...
*/
exports.alkaneTokenDeploy = new AlkanesCommand('new-token')
    .requiredOption('-resNumber, --reserveNumber <reserveNumber>', 'Number to reserve for factory id')
    .requiredOption('-c, --cap <cap>', 'the token cap')
    .requiredOption('-name, --token-name <name>', 'the token name')
    .requiredOption('-symbol, --token-symbol <symbol>', 'the token symbol')
    .requiredOption('-amount, --amount-per-mint <amount-per-mint>', 'Amount of tokens minted each time mint is called')
    .option('-pre, --premine <premine>', 'amount to premine')
    .option('-i, --image <image>', 'Relative path to image file to deploy (e.g., "../alkanes/free_mint.wasm")')
    .option('-p, --provider <provider>', 'Network provider type (regtest, bitcoin)')
    .option('-feeRate, --feeRate <feeRate>', 'fee rate')
    .action(async (options) => {
    const wallet = new wallet_1.Wallet(options);
    const { accountUtxos } = await utxo.accountUtxos({
        account: wallet.account,
        provider: wallet.provider,
    });
    const tokenName = (0, utils_1.packUTF8)(options.tokenName);
    const tokenSymbol = (0, utils_1.packUTF8)(options.tokenSymbol);
    if (tokenName.length > 2) {
        throw new Error('Token name too long');
    }
    if (tokenSymbol.length > 1) {
        throw new Error('Token symbol too long');
    }
    const calldata = [
        BigInt(6),
        BigInt(options.reserveNumber),
        BigInt(0),
        BigInt(options.premine ?? 0),
        BigInt(options.amountPerMint),
        BigInt(options.cap),
        BigInt('0x' + tokenName[0]),
        BigInt(tokenName.length > 1 ? '0x' + tokenName[1] : 0),
        BigInt('0x' + tokenSymbol[0]),
    ];
    const protostone = (0, proto_runestone_upgrade_1.encodeRunestoneProtostone)({
        protostones: [
            protostone_1.ProtoStone.message({
                protocolTag: 1n,
                edicts: [],
                pointer: 0,
                refundPointer: 0,
                calldata: (0, bytes_1.encipher)(calldata),
            }),
        ],
    }).encodedRunestone;
    if (options.image) {
        const image = new Uint8Array(Array.from(await fs_extra_1.default.readFile(path_1.default.resolve(process.cwd(), options.image))));
        const gzip = (0, util_1.promisify)(node_zlib_1.gzip);
        const payload = {
            body: await gzip(image, { level: 9 }),
            cursed: false,
            tags: { contentType: '' },
        };
        console.log(await (0, token_1.tokenDeployment)({
            payload,
            protostone,
            utxos: accountUtxos,
            feeRate: wallet.feeRate,
            account: wallet.account,
            signer: wallet.signer,
            provider: wallet.provider,
        }));
        return;
    }
    console.log(await alkanes.execute({
        protostone,
        utxos: accountUtxos,
        feeRate: wallet.feeRate,
        account: wallet.account,
        signer: wallet.signer,
        provider: wallet.provider,
    }));
});
/* @dev example call
  oyl alkane execute -data 2,1,77 -e 2:1:333:1

  In this example we call a mint (opcode 77) from the [2,1] token. The token
  will mint to the wallet calling execute.

  We also pass the edict 2:1:333:1. That is id [2,1], the amount is 333, and the output is vout 1.

  Hint: you can grab the TEST_WALLET's alkanes balance with:
  oyl provider alkanes -method getAlkanesByAddress -params '{"address":"bcrt1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqvg32hk"}'
*/
exports.alkaneExecute = new AlkanesCommand('execute')
    .requiredOption('-data, --calldata <calldata>', 'op code + params to be called on a contract', (value, previous) => {
    const items = value.split(',');
    return previous ? previous.concat(items) : items;
}, [])
    .option('-e, --edicts <edicts>', 'edicts for protostone', (value, previous) => {
    const items = value.split(',');
    return previous ? previous.concat(items) : items;
}, [])
    .option('-m, --mnemonic <mnemonic>', '(optional) Mnemonic used for signing transactions (default = TEST_WALLET)')
    .option('-p, --provider <provider>', 'Network provider type (regtest, bitcoin)')
    .option('-feeRate, --feeRate <feeRate>', 'fee rate')
    .requiredOption('-alkaneReceiver, --alkane-receiver <alkaneReceiver>', 'Address to receive alkane assets (required)')
    .option('--disable-change', 'Execute transaction without change output (absorbs remaining balance into fee)')
    .action(async (options) => {
    const wallet = new wallet_1.Wallet(options);
    const { accountUtxos } = await utxo.accountUtxos({
        account: wallet.account,
        provider: wallet.provider,
    });
    const calldata = options.calldata.map((item) => BigInt(item));
    const edicts = options.edicts.map((item) => {
        const [block, tx, amount, output] = item
            .split(':')
            .map((part) => part.trim());
        return {
            id: new protoruneruneid_1.ProtoruneRuneId((0, integer_1.u128)(block), (0, integer_1.u128)(tx)),
            amount: amount ? BigInt(amount) : undefined,
            output: output ? Number(output) : undefined,
        };
    });
    const protostone = (0, proto_runestone_upgrade_1.encodeRunestoneProtostone)({
        protostones: [
            protostone_1.ProtoStone.message({
                protocolTag: 1n,
                edicts,
                pointer: 0,
                refundPointer: 0,
                calldata: (0, bytes_1.encipher)(calldata),
            }),
        ],
    }).encodedRunestone;
    const noChange = options.disableChange || false;
    console.log(await alkanes.execute({
        protostone,
        utxos: accountUtxos,
        feeRate: wallet.feeRate,
        account: wallet.account,
        signer: wallet.signer,
        provider: wallet.provider,
        alkaneReceiverAddress: options.alkaneReceiver,
        enableRBF: false,
        noChange: noChange,
    }));
});
/* @dev example call
  oyl alkane   -data "2,9,1" -p alkanes -feeRate 5 -blk 2 -tx 1 -amt 200

  Burns an alkane LP token amount
*/
exports.alkaneRemoveLiquidity = new AlkanesCommand('remove-liquidity')
    .requiredOption('-data, --calldata <calldata>', 'op code + params to be called on a contract', (value, previous) => {
    const items = value.split(',');
    return previous ? previous.concat(items) : items;
}, [])
    .requiredOption('-amt, --amount <amount>', 'amount to burn')
    .requiredOption('-blk, --block <block>', 'block number')
    .requiredOption('-tx, --txNum <txNum>', 'transaction number')
    .option('-p, --provider <provider>', 'Network provider type (regtest, bitcoin)')
    .option('-feeRate, --feeRate <feeRate>', 'fee rate')
    .action(async (options) => {
    const wallet = new wallet_1.Wallet(options);
    const { accountUtxos } = await utxo.accountUtxos({
        account: wallet.account,
        provider: wallet.provider,
    });
    const calldata = options.calldata.map((item) => BigInt(item));
    console.log(await (0, pool_1.removeLiquidity)({
        calldata,
        token: { block: options.block, tx: options.txNum },
        tokenAmount: BigInt(options.amount),
        utxos: accountUtxos,
        feeRate: wallet.feeRate,
        account: wallet.account,
        signer: wallet.signer,
        provider: wallet.provider,
    }));
});
/* @dev example call
  oyl alkane swap -data "2,7,3,160" -p alkanes -feeRate 5 -blk 2 -tx 1 -amt 200

  Swaps an alkane from a pool
*/
exports.alkaneSwap = new AlkanesCommand('swap')
    .requiredOption('-data, --calldata <calldata>', 'op code + params to be called on a contract', (value, previous) => {
    const items = value.split(',');
    return previous ? previous.concat(items) : items;
}, [])
    .requiredOption('-amt, --amount <amount>', 'amount to swap')
    .requiredOption('-blk, --block <block>', 'block number')
    .requiredOption('-tx, --txNum <txNum>', 'transaction number')
    .option('-p, --provider <provider>', 'Network provider type (regtest, bitcoin)')
    .option('-feeRate, --feeRate <feeRate>', 'fee rate')
    .action(async (options) => {
    const wallet = new wallet_1.Wallet(options);
    const { accountUtxos } = await utxo.accountUtxos({
        account: wallet.account,
        provider: wallet.provider,
    });
    const calldata = options.calldata.map((item) => BigInt(item));
    console.log(await (0, pool_1.swap)({
        calldata,
        token: { block: options.block, tx: options.txNum },
        tokenAmount: BigInt(options.amount),
        utxos: accountUtxos,
        feeRate: wallet.feeRate,
        account: wallet.account,
        signer: wallet.signer,
        provider: wallet.provider,
    }));
});
/* @dev example call
  oyl alkane send -blk 2 -tx 1 -amt 200 -to bcrt1pkq6ayylfpe5hn05550ry25pkakuf72x9qkjc2sl06dfcet8sg25ql4dm73

  Sends an alkane token amount to a given address (example is sending token with Alkane ID [2, 1])
*/
exports.alkaneSend = new AlkanesCommand('send')
    .requiredOption('-to, --to <to>')
    .requiredOption('-amt, --amount <amount>')
    .requiredOption('-blk, --block <block>')
    .requiredOption('-tx, --txNum <txNum>')
    .option('-m, --mnemonic <mnemonic>', '(optional) Mnemonic used for signing transactions (default = TEST_WALLET)')
    .option('-p, --provider <provider>', 'Network provider type (regtest, bitcoin)')
    .option('-feeRate, --feeRate <feeRate>', 'fee rate')
    .action(async (options) => {
    const wallet = new wallet_1.Wallet(options);
    const { accountUtxos } = await utxo.accountUtxos({
        account: wallet.account,
        provider: wallet.provider,
    });
    console.log(await (0, token_1.send)({
        utxos: accountUtxos,
        alkaneId: { block: options.block, tx: options.txNum },
        toAddress: options.to,
        amount: Number(options.amount),
        account: wallet.account,
        signer: wallet.signer,
        provider: wallet.provider,
        feeRate: wallet.feeRate,
    }));
});
/* @dev example call
 oyl alkane create-pool -data "2,1,1" -tokens "2:12:1500,2:29:1500" -feeRate 5 -p oylnet

Creates a new pool with the given tokens and amounts
*/
exports.alkaneCreatePool = new AlkanesCommand('create-pool')
    .requiredOption('-data, --calldata <calldata>', 'op code + params to be called on a contract', (value, previous) => {
    const items = value.split(',');
    return previous ? previous.concat(items) : items;
}, [])
    .requiredOption('-tokens, --tokens <tokens>', 'tokens and amounts to pair for pool', (value, previous) => {
    const items = value.split(',');
    return previous ? previous.concat(items) : items;
}, [])
    .option('-m, --mnemonic <mnemonic>', '(optional) Mnemonic used for signing transactions (default = TEST_WALLET)')
    .option('-p, --provider <provider>', 'Network provider type (regtest, bitcoin)')
    .option('-feeRate, --feeRate <feeRate>', 'fee rate')
    .action(async (options) => {
    const wallet = new wallet_1.Wallet(options);
    const { accountUtxos } = await utxo.accountUtxos({
        account: wallet.account,
        provider: wallet.provider,
    });
    const calldata = options.calldata.map((item) => BigInt(item));
    const alkaneTokensToPool = options.tokens.map((item) => {
        const [block, tx, amount] = item.split(':').map((part) => part.trim());
        return {
            alkaneId: { block: block, tx: tx },
            amount: BigInt(amount),
        };
    });
    console.log(await (0, factory_1.createNewPool)({
        calldata,
        token0: alkaneTokensToPool[0].alkaneId,
        token0Amount: alkaneTokensToPool[0].amount,
        token1: alkaneTokensToPool[1].alkaneId,
        token1Amount: alkaneTokensToPool[1].amount,
        utxos: accountUtxos,
        feeRate: wallet.feeRate,
        account: wallet.account,
        signer: wallet.signer,
        provider: wallet.provider,
    }));
});
/* @dev example call
 oyl alkane add-liquidity -data "2,1,1" -tokens "2:2:50000,2:3:50000" -feeRate 5 -p alkanes

Mints new LP tokens and adds liquidity to the pool with the given tokens and amounts
*/
exports.alkaneAddLiquidity = new AlkanesCommand('add-liquidity')
    .requiredOption('-data, --calldata <calldata>', 'op code + params to be called on a contract', (value, previous) => {
    const items = value.split(',');
    return previous ? previous.concat(items) : items;
}, [])
    .requiredOption('-tokens, --tokens <tokens>', 'tokens and amounts to pair for pool', (value, previous) => {
    const items = value.split(',');
    return previous ? previous.concat(items) : items;
}, [])
    .option('-m, --mnemonic <mnemonic>', '(optional) Mnemonic used for signing transactions (default = TEST_WALLET)')
    .option('-p, --provider <provider>', 'Network provider type (regtest, bitcoin)')
    .option('-feeRate, --feeRate <feeRate>', 'fee rate')
    .action(async (options) => {
    const wallet = new wallet_1.Wallet(options);
    const { accountUtxos } = await utxo.accountUtxos({
        account: wallet.account,
        provider: wallet.provider,
    });
    const calldata = options.calldata.map((item) => BigInt(item));
    const alkaneTokensToMint = options.tokens.map((item) => {
        const [block, tx, amount] = item.split(':').map((part) => part.trim());
        return {
            alkaneId: { block: block, tx: tx },
            amount: BigInt(amount),
        };
    });
    console.log(await (0, pool_1.addLiquidity)({
        calldata,
        token0: alkaneTokensToMint[0].alkaneId,
        token0Amount: alkaneTokensToMint[0].amount,
        token1: alkaneTokensToMint[1].alkaneId,
        token1Amount: alkaneTokensToMint[1].amount,
        utxos: accountUtxos,
        feeRate: wallet.feeRate,
        account: wallet.account,
        signer: wallet.signer,
        provider: wallet.provider,
    }));
});
/* @dev example call
 AMM factory:
 oyl alkane simulate  -target "2:1" -inputs "1,2,6,2,7" -tokens "2:6:1000,2:7:2000" -decoder "factory"
 oyl alkane simulate  -target "2:1" -inputs "2,2,3,2,4" -decoder "factory"

  Simulates an operation using the pool decoder
  First input is the opcode
*/
exports.alkaneSimulate = new AlkanesCommand('simulate')
    .requiredOption('-target, --target <target>', 'target block:tx for simulation', (value) => {
    const [block, tx] = value.split(':').map((part) => part.trim());
    return { block: block.toString(), tx: tx.toString() };
})
    .requiredOption('-inputs, --inputs <inputs>', 'inputs for simulation (comma-separated)', (value) => value.split(',').map((item) => item.trim()))
    .option('-tokens, --tokens <tokens>', 'tokens and amounts to pair for pool', (value) => {
    return value.split(',').map((item) => {
        const [block, tx, value] = item.split(':').map((part) => part.trim());
        return {
            id: { block, tx },
            value,
        };
    });
}, [])
    .option('-decoder, --decoder <decoder>', 'decoder to use for simulation results (e.g., "pool")')
    .option('-p, --provider <provider>', 'Network provider type (regtest, bitcoin)')
    .action(async (options) => {
    const wallet = new wallet_1.Wallet(options);
    const request = {
        alkanes: options.tokens,
        transaction: '0x',
        block: '0x',
        height: '20000',
        txindex: 0,
        target: options.target,
        inputs: options.inputs,
        pointer: 0,
        refundPointer: 0,
        vout: 0,
    };
    let decoder;
    switch (options.decoder) {
        case 'pool':
            const { AlkanesAMMPoolDecoder } = await Promise.resolve().then(() => tslib_1.__importStar(require('../amm/pool')));
            decoder = (result) => AlkanesAMMPoolDecoder.decodeSimulation(result, Number(options.inputs[0]));
            break;
        case 'factory':
            const { AlkanesAMMPoolFactoryDecoder } = await Promise.resolve().then(() => tslib_1.__importStar(require('../amm/factory')));
            decoder = (result) => AlkanesAMMPoolFactoryDecoder.decodeSimulation(result, Number(options.inputs[0]));
    }
    console.log(JSON.stringify(await wallet.provider.alkanes.simulate(request, decoder), null, 2));
});
/* @dev example call
 oyl alkane get-all-pools-details -target "2:1"

 Gets details for all pools by:
 1. Getting all pool IDs from the factory contract
 2. For each pool ID, getting its details
 3. Returning a combined result with all pool details
*/
exports.alkaneGetAllPoolsDetails = new AlkanesCommand('get-all-pools-details')
    .requiredOption('-target, --target <target>', 'target block:tx for the factory contract', (value) => {
    const [block, tx] = value.split(':').map((part) => part.trim());
    return { block: block.toString(), tx: tx.toString() };
})
    .option('-p, --provider <provider>', 'Network provider type (regtest, bitcoin)')
    .action(async (options) => {
    const wallet = new wallet_1.Wallet(options);
    const { AlkanesAMMPoolFactoryDecoder, PoolFactoryOpcodes } = await Promise.resolve().then(() => tslib_1.__importStar(require('../amm/factory')));
    const request = {
        alkanes: [],
        transaction: '0x',
        block: '0x',
        height: '20000',
        txindex: 0,
        target: options.target,
        inputs: [PoolFactoryOpcodes.GET_ALL_POOLS.toString()],
        pointer: 0,
        refundPointer: 0,
        vout: 0,
    };
    const factoryResult = await wallet.provider.alkanes.simulate(request);
    const factoryDecoder = new AlkanesAMMPoolFactoryDecoder();
    const allPoolsDetails = await factoryDecoder.decodeAllPoolsDetails(factoryResult.execution, wallet.provider);
    console.log(JSON.stringify(allPoolsDetails, null, 2));
});
/* @dev example call
 oyl alkane preview-remove-liquidity -token "2:1" -amount 1000000

 Previews the tokens that would be received when removing liquidity from a pool
*/
exports.alkanePreviewRemoveLiquidity = new AlkanesCommand('preview-remove-liquidity')
    .requiredOption('-token, --token <token>', 'LP token ID in the format block:tx', (value) => {
    const [block, tx] = value.split(':').map((part) => part.trim());
    return { block: block.toString(), tx: tx.toString() };
})
    .requiredOption('-amount, --amount <amount>', 'Amount of LP tokens to remove', (value) => BigInt(value))
    .option('-p, --provider <provider>', 'Network provider type (regtest, bitcoin)')
    .action(async (options) => {
    const wallet = new wallet_1.Wallet(options);
    try {
        const previewResult = await wallet.provider.alkanes.previewRemoveLiquidity({
            token: options.token,
            tokenAmount: options.amount,
        });
        console.log(JSON.stringify({
            token0: `${previewResult.token0.block}:${previewResult.token0.tx}`,
            token1: `${previewResult.token1.block}:${previewResult.token1.tx}`,
            token0Amount: previewResult.token0Amount.toString(),
            token1Amount: previewResult.token1Amount.toString(),
        }, null, 2));
    }
    catch (error) {
        console.error('Error previewing liquidity removal:', error.message);
    }
});
exports.alkaneList = new AlkanesCommand('list')
    .description('Lists all Alkanes assets owned by the account.')
    .option('-p, --provider <provider>', 'Network provider type (regtest, bitcoin)', 'bitcoin')
    .option('-d, --detailed', 'Show detailed UTXO breakdown instead of aggregated view')
    .action(async (options) => {
    const wallet = new wallet_1.Wallet({ networkType: options.provider });
    const accountPortfolio = await utxo.accountUtxos({
        account: wallet.account,
        provider: wallet.provider,
    });
    console.log(`=== ALKANES BALANCE OVERVIEW ===`);
    console.log(`Provider: ${options.provider}\n`);
    // Aggregate alkanes by token ID
    const alkaneBalances = new Map();
    let foundAlkanes = false;
    if (accountPortfolio.accountUtxos && accountPortfolio.accountUtxos.length > 0) {
        accountPortfolio.accountUtxos.forEach((utxoItem) => {
            if (utxoItem.alkanes && Object.keys(utxoItem.alkanes).length > 0) {
                foundAlkanes = true;
                for (const alkaneId in utxoItem.alkanes) {
                    if (Object.prototype.hasOwnProperty.call(utxoItem.alkanes, alkaneId)) {
                        const alkaneDetails = utxoItem.alkanes[alkaneId];
                        if (!alkaneBalances.has(alkaneId)) {
                            alkaneBalances.set(alkaneId, {
                                name: alkaneDetails.name,
                                symbol: alkaneDetails.symbol,
                                totalValue: 0,
                                utxoCount: 0,
                                utxos: []
                            });
                        }
                        const balance = alkaneBalances.get(alkaneId);
                        balance.totalValue += Number(alkaneDetails.value);
                        balance.utxoCount += 1;
                        balance.utxos.push({
                            txId: utxoItem.txId,
                            outputIndex: utxoItem.outputIndex,
                            address: utxoItem.address,
                            value: alkaneDetails.value
                        });
                    }
                }
            }
        });
    }
    if (!foundAlkanes) {
        console.log('  No Alkanes assets found for this account.');
        return;
    }
    if (options.detailed) {
        // Show detailed UTXO breakdown
        console.log('📋 Detailed UTXO Breakdown:');
        alkaneBalances.forEach((balance, alkaneId) => {
            console.log(`\n🪙 ${alkaneId} (${balance.name} / ${balance.symbol})`);
            console.log(`   Total Balance: ${balance.totalValue}`);
            console.log(`   UTXOs: ${balance.utxoCount}`);
            console.log('   ─────────────────────────────────────────');
            balance.utxos.forEach((utxo) => {
                console.log(`   📦 ${utxo.txId}:${utxo.outputIndex}`);
                console.log(`      Address: ${utxo.address}`);
                console.log(`      Amount: ${utxo.value}`);
                console.log('');
            });
        });
    }
    else {
        // Show aggregated view (default)
        console.log('💰 Aggregated Token Balances:');
        console.log('');
        alkaneBalances.forEach((balance, alkaneId) => {
            console.log(`🪙 ${alkaneId}`);
            console.log(`   Name: ${balance.name}`);
            console.log(`   Symbol: ${balance.symbol}`);
            console.log(`   Total Balance: ${balance.totalValue}`);
            console.log(`   Held in ${balance.utxoCount} UTXO(s)`);
            console.log('');
        });
        console.log('─────────────────────────────────────────');
        console.log(`📊 Summary: ${alkaneBalances.size} unique alkane type(s) found`);
        console.log(`💡 Use --detailed flag for UTXO breakdown`);
    }
});
/* @dev example call
  oyl alkane batch-execute -data 2,1,77 -n 100 -feeRate 10 -p regtest

  Executes alkane operation with 100 child accounts (excluding main account)
  All child accounts will execute the same calldata concurrently
*/
exports.alkaneBatchExecute = new AlkanesCommand('batch-execute')
    .requiredOption('-data, --calldata <calldata>', 'op code + params to be called on a contract', (value, previous) => {
    const items = value.split(',');
    return previous ? previous.concat(items) : items;
}, [])
    .requiredOption('-n, --accountCount <accountCount>', 'number of child accounts to execute with (excluding main account)')
    .option('-e, --edicts <edicts>', 'edicts for protostone', (value, previous) => {
    const items = value.split(',');
    return previous ? previous.concat(items) : items;
}, [])
    .option('-m, --mnemonic <mnemonic>', '(optional) Mnemonic used for signing transactions (default = TEST_WALLET)')
    .option('-p, --provider <provider>', 'Network provider type (regtest, bitcoin)')
    .option('-feeRate, --feeRate <feeRate>', 'fee rate')
    .requiredOption('-alkaneReceiver, --alkane-receiver <alkaneReceiver>', 'Address to receive alkane assets (required)')
    .action(async (options) => {
    const wallet = new wallet_1.Wallet(options);
    const { accountUtxos } = await utxo.accountUtxos({
        account: wallet.account,
        provider: wallet.provider,
    });
    const calldata = options.calldata.map((item) => BigInt(item));
    const edicts = options.edicts.map((item) => {
        const [block, tx, amount, output] = item
            .split(':')
            .map((part) => part.trim());
        return {
            id: new protoruneruneid_1.ProtoruneRuneId((0, integer_1.u128)(block), (0, integer_1.u128)(tx)),
            amount: amount ? BigInt(amount) : undefined,
            output: output ? Number(output) : undefined,
        };
    });
    const protostone = (0, proto_runestone_upgrade_1.encodeRunestoneProtostone)({
        protostones: [
            protostone_1.ProtoStone.message({
                protocolTag: 1n,
                edicts,
                pointer: 0,
                refundPointer: 0,
                calldata: (0, bytes_1.encipher)(calldata),
            }),
        ],
    }).encodedRunestone;
    console.log(await alkanes.batchExecute({
        protostone,
        utxos: accountUtxos,
        feeRate: wallet.feeRate,
        account: wallet.account,
        signer: wallet.signer,
        provider: wallet.provider,
        accountCount: parseInt(options.accountCount),
        mnemonic: wallet.mnemonic,
        alkaneReceiverAddress: options.alkaneReceiver,
    }));
});
/* @dev example call
  oyl alkane estimate-fee -data 2,1,77 -feeRate 10 -inputCount 1

  Estimates the exact fee needed for an alkane transaction without change output
*/
exports.alkaneEstimateFee = new AlkanesCommand('estimate-fee')
    .requiredOption('-data, --calldata <calldata>', 'op code + params to be called on a contract', (value, previous) => {
    const items = value.split(',');
    return previous ? previous.concat(items) : items;
}, [])
    .option('-e, --edicts <edicts>', 'edicts for protostone', (value, previous) => {
    const items = value.split(',');
    return previous ? previous.concat(items) : items;
}, [])
    .option('-p, --provider <provider>', 'Network provider type (regtest, bitcoin)')
    .requiredOption('-feeRate, --feeRate <feeRate>', 'fee rate in sat/vB')
    .option('-inputCount, --input-count <inputCount>', 'number of inputs to estimate for (defaults to 1)', '1')
    .option('-frontendFee, --frontend-fee <frontendFee>', 'frontend fee in satoshis')
    .option('-feeAddress, --fee-address <feeAddress>', 'address to receive frontend fee')
    .option('-alkaneReceiver, --alkane-receiver <alkaneReceiver>', 'Address to receive alkane assets (defaults to wallet address)')
    .option('--disable-change', 'Calculate fee for transaction without change output (absorbs remaining balance into fee)')
    .action(async (options) => {
    const wallet = new wallet_1.Wallet(options);
    // Get real UTXOs from the account
    const { accountUtxos } = await utxo.accountUtxos({
        account: wallet.account,
        provider: wallet.provider,
    });
    const calldata = options.calldata.map((item) => BigInt(item));
    const edicts = options.edicts.map((item) => {
        const [block, tx, amount, output] = item
            .split(':')
            .map((part) => part.trim());
        return {
            id: new protoruneruneid_1.ProtoruneRuneId((0, integer_1.u128)(block), (0, integer_1.u128)(tx)),
            amount: amount ? BigInt(amount) : undefined,
            output: output ? Number(output) : undefined,
        };
    });
    const protostone = (0, proto_runestone_upgrade_1.encodeRunestoneProtostone)({
        protostones: [
            protostone_1.ProtoStone.message({
                protocolTag: 1n,
                edicts,
                pointer: 0,
                refundPointer: 0,
                calldata: (0, bytes_1.encipher)(calldata),
            }),
        ],
    }).encodedRunestone;
    // Use actualExecuteFee for precise calculation with real UTXOs
    const noChange = options.disableChange || false;
    const result = await alkanes.actualExecuteFee({
        utxos: accountUtxos,
        account: wallet.account,
        protostone,
        provider: wallet.provider,
        feeRate: parseFloat(options.feeRate),
        frontendFee: options.frontendFee ? BigInt(options.frontendFee) : undefined,
        feeAddress: options.feeAddress,
        alkaneReceiverAddress: options.alkaneReceiver,
        noChange: noChange,
    });
    const totalRequired = utils_1.inscriptionSats + Number(options.frontendFee || 0) + result.fee;
    console.log(JSON.stringify({
        estimatedFee: result.fee,
        totalRequired: totalRequired,
        breakdown: {
            alkaneOutput: utils_1.inscriptionSats,
            frontendFee: Number(options.frontendFee || 0),
            transactionFee: result.fee,
            vsize: result.vsize,
        },
        recommendation: {
            message: "Use this totalRequired amount for UTXO splitting to ensure exact balance for alkane execution without change",
            splitAmount: totalRequired
        }
    }, null, 2));
});
// ============================================================================
// Project Snowball - Chain Minting Command
// ============================================================================
exports.alkaneChainMint = new AlkanesCommand('chain-mint')
    .description('Execute unified alkane chain minting with automatic scaling (1-2500 tokens)')
    .option('-p, --provider <provider>', 'Network provider type (regtest, bitcoin, testnet)', 'regtest')
    .option('-c, --contract <contract>', 'Contract ID in format "block:tx" (e.g., "12345:1")')
    .option('-r, --receiver <address>', 'Final receiver address for all minted tokens')
    .option('-n, --total-mints <count>', 'Total number of tokens to mint (1-2500). Automatically scales execution strategy', '25')
    .option('--fee-rate <sats>', 'Fee rate in sat/vB', '10')
    .option('--cpfp-multiplier <multiplier>', 'CPFP acceleration multiplier for first slice (only for Supercluster mode)', '3')
    .option('--max-concurrent <count>', 'Maximum concurrent slices for parallel execution (1-20, only for Supercluster mode)', '6')
    .option('--disable-parallel', 'Force serial execution even in Supercluster mode')
    .option('--dry-run', 'Only calculate fees and preview the transaction plan, do not execute')
    .option('--retry-max <count>', 'Maximum retry attempts for broadcasting', '3')
    .option('--retry-delay <ms>', 'Delay between retries in milliseconds', '5000')
    .option('--no-wait', 'Do not wait for transaction acceptance before broadcasting next')
    .option('--enable-verification', 'Enable on-chain verification and asset balance checking after execution')
    .option('--verification-timeout <minutes>', 'Maximum time to wait for verification (0 = no timeout)', '30')
    .option('--verbose', 'Enable verbose logging')
    .option('--simulate', 'Simulation mode: Sign transactions but do not broadcast (for testing)')
    .action(async (options) => {
    try {
        // 1. 验证必需参数
        if (!options.contract) {
            throw new Error('Contract ID is required. Use -c "block:tx" format');
        }
        if (!options.receiver) {
            throw new Error('Receiver address is required. Use -r <address>');
        }
        // 2. 解析合约ID
        const contractParts = options.contract.split(':');
        if (contractParts.length !== 2) {
            throw new Error('Invalid contract ID format. Use "block:tx" format');
        }
        const contractId = {
            block: contractParts[0],
            tx: contractParts[1]
        };
        // 3. 验证基本参数
        const feeRate = parseFloat(options.feeRate);
        const totalMints = parseInt(options.totalMints);
        if (feeRate < 0.1 || feeRate > 1000) {
            throw new Error('Fee rate must be between 0.1 and 1000 sat/vB');
        }
        if (totalMints < 1 || totalMints > 2500) {
            throw new Error('Total mints must be between 1 and 2500');
        }
        // 4. 显示配置信息
        const expectedSlices = Math.ceil(totalMints / 25);
        console.log(`\n🚀 Alkane Chain Minting`);
        console.log(`==============================\n`);
        console.log(`📋 Configuration:`);
        console.log(`   Network: ${options.provider}`);
        console.log(`   Contract: ${options.contract}`);
        console.log(`   Receiver: ${options.receiver}`);
        console.log(`   Total Mints: ${totalMints} tokens`);
        console.log(`   Fee Rate: ${feeRate} sat/vB`);
        console.log(`   Dry Run: ${options.dryRun ? 'Yes' : 'No'}`);
        console.log(`   Simulation Mode: ${options.simulate ? 'Yes' : 'No'}`);
        console.log(`   Expected Slices: ${expectedSlices}`);
        if (expectedSlices > 1) {
            const maxConcurrent = parseInt(options.maxConcurrent);
            const cpfpMultiplier = parseFloat(options.cpfpMultiplier);
            const enableParallel = !options.disableParallel;
            console.log(`   CPFP Multiplier: ${cpfpMultiplier}x`);
            console.log(`   Max Concurrent: ${maxConcurrent}`);
            console.log(`   Parallel Execution: ${enableParallel ? 'Enabled' : 'Disabled'}`);
        }
        console.log(``);
        // 5. 创建钱包和提供者
        const wallet = new wallet_1.Wallet({ networkType: options.provider });
        const provider = wallet.provider;
        // 6. 执行统一的Supercluster逻辑 (兼容所有场景)
        await executeParallelChainMinting_CLI({
            options,
            contractId,
            totalMints,
            feeRate,
            provider,
            wallet
        });
    }
    catch (error) {
        console.error(`\n💥 Chain Minting Failed:`);
        if (error instanceof chainMinting_1.ChainMintingError) {
            console.error(`   Error Type: ${error.type}`);
            console.error(`   Message: ${error.message}`);
            if (error.details && options.verbose) {
                console.error(`   Details:`, JSON.stringify(error.details, null, 2));
            }
        }
        else {
            console.error(`   ${error.message}`);
            if (options.verbose) {
                console.error(`   Stack:`, error.stack);
            }
        }
        console.error(`\n💡 Troubleshooting tips:`);
        console.error(`   1. Check that BATCH_MINT_MNEMONIC is set in your .env file`);
        console.error(`   2. Ensure sufficient BTC balance in your main wallet`);
        console.error(`   3. Verify the contract ID exists and is a valid mint contract`);
        console.error(`   4. Try running with --dry-run first to check the setup`);
        console.error(`   5. Use --verbose for more detailed error information`);
        process.exit(1);
    }
});
// ============================================================================
// Project Supercluster CLI执行函数
// ============================================================================
async function executeParallelChainMinting_CLI({ options, contractId, totalMints, feeRate, provider, wallet }) {
    const { executeParallelChainMintingWithTracking, validateParallelMintingConfig } = await Promise.resolve().then(() => tslib_1.__importStar(require('../alkanes/parallelCoordinator')));
    console.log(`🔐 Generating multi-relay wallet system...`);
    // 检查余额
    console.log(`💳 Checking balance...`);
    const accountPortfolio = await utxo.accountUtxos({
        account: wallet.account,
        provider
    });
    const totalBtcBalance = accountPortfolio.accountTotalBalance;
    console.log(`   Available BTC: ${totalBtcBalance} sats`);
    // 准备并行铸造配置
    const cpfpMultiplier = parseFloat(options.cpfpMultiplier);
    const config = {
        contractId,
        totalMints,
        finalReceiverAddress: options.receiver,
        network: provider.network,
        feeRateConfig: {
            standardFeeRate: feeRate,
            cpfpFeeRate: feeRate * cpfpMultiplier,
            cpfpMultiplier
        },
        utxos: accountPortfolio.accountUtxos,
        provider,
        broadcastConfig: {
            maxRetries: parseInt(options.retryMax || '3'),
            retryDelayMs: parseInt(options.retryDelay || '5000'),
            confirmationTimeoutMs: 0,
            waitForAcceptance: !options.noWait,
            simulationMode: options.simulate || false
        },
        enableParallelExecution: !options.disableParallel,
        maxConcurrentSlices: parseInt(options.maxConcurrent),
        cpfpConfirmationTimeout: 600000 // 10分钟CPFP确认超时
    };
    // 验证配置
    const configValidation = validateParallelMintingConfig(config);
    if (!configValidation.isValid) {
        throw new Error(`Configuration validation failed: ${configValidation.errors.join(', ')}`);
    }
    // Dry run模式
    if (options.dryRun) {
        console.log(`🎯 DRY RUN COMPLETE - No transactions were executed`);
        console.log(``);
        console.log(`📊 Execution Plan:`);
        console.log(`   1. Generate ${Math.ceil(totalMints / 25)} relay wallets`);
        console.log(`   2. Build composite parent transaction with multiple outputs`);
        console.log(`   3. Execute CPFP acceleration for first slice`);
        console.log(`   4. Parallel execution of ${Math.ceil(totalMints / 25)} slices`);
        console.log(`   5. Monitor and aggregate final results`);
        console.log(``);
        console.log(`💡 To execute for real, remove the --dry-run flag`);
        return;
    }
    // 执行并行铸造
    const result = await executeParallelChainMintingWithTracking(config, (progress) => {
        console.log(`📊 Progress: ${progress.overallProgress}% - ${progress.message}`);
    });
    if (result.success) {
        console.log(`\n🎉 链式铸造执行成功！`);
        console.log(`   总耗时: ${(result.totalDuration / 1000).toFixed(1)} 秒`);
        console.log(`   成功分片: ${result.statistics.successfulSlices}/${result.statistics.totalSlices}`);
        console.log(`   铸造tokens: ${result.statistics.totalTokensMinted}`);
        console.log(`   并行效率: ${(result.statistics.parallelEfficiency * 100).toFixed(1)}%`);
    }
    else {
        throw new Error(`Parallel execution failed: ${result.error?.message}`);
    }
}
exports.executeParallelChainMinting_CLI = executeParallelChainMinting_CLI;
// ============================================================================
// 链上验证命令
// ============================================================================
exports.alkaneVerifyChain = new AlkanesCommand('verify-chain')
    .description('Verify an existing Project Snowball chain minting execution')
    .option('-p, --provider <provider>', 'Network provider type (regtest, bitcoin, testnet)', 'regtest')
    .requiredOption('-c, --contract <contract>', 'Contract ID in format "block:tx" (e.g., "12345:1")')
    .requiredOption('-r, --receiver <address>', 'Final receiver address to verify')
    .requiredOption('--parent-tx <txId>', 'Parent transaction ID')
    .requiredOption('--child-txs <txIds>', 'Comma-separated list of child transaction IDs')
    .option('--timeout <minutes>', 'Maximum time to wait for verification (0 = no timeout)', '30')
    .option('--verbose', 'Enable verbose logging')
    .action(async (options) => {
    try {
        console.log(`\n🔍 Project Snowball - 链上验证`);
        console.log(`=====================================\n`);
        // 验证必需参数
        if (!options.contract) {
            throw new Error('Contract ID is required. Use -c "block:tx" format');
        }
        if (!options.receiver) {
            throw new Error('Receiver address is required. Use -r <address>');
        }
        if (!options.parentTx) {
            throw new Error('Parent transaction ID is required. Use --parent-tx <txId>');
        }
        if (!options.childTxs) {
            throw new Error('Child transaction IDs are required. Use --child-txs <txId1,txId2,...>');
        }
        // 解析参数
        const contractParts = options.contract.split(':');
        if (contractParts.length !== 2) {
            throw new Error('Invalid contract ID format. Use "block:tx" format');
        }
        const contractId = {
            block: contractParts[0],
            tx: contractParts[1]
        };
        const childTxIds = options.childTxs.split(',').map((id) => id.trim());
        const timeoutMs = parseInt(options.timeout) * 60 * 1000;
        console.log(`📋 验证配置:`);
        console.log(`   Network: ${options.provider}`);
        console.log(`   Contract: ${options.contract}`);
        console.log(`   Receiver: ${options.receiver}`);
        console.log(`   Parent TX: ${options.parentTx}`);
        console.log(`   Child TXs: ${childTxIds.length} transactions`);
        console.log(`   Timeout: ${options.timeout} minutes`);
        console.log(``);
        // 创建提供者
        const wallet = new wallet_1.Wallet({ networkType: options.provider });
        const provider = wallet.provider;
        // 配置验证参数
        const verificationConfig = {
            pollInterval: 10000,
            maxWaitTime: timeoutMs,
            verboseLogging: options.verbose || false,
            checkAssetBalance: true,
            onProgress: (status) => {
                const confirmed = status.confirmedTransactions;
                const total = status.totalTransactions;
                const percentage = Math.round((confirmed / total) * 100);
                console.log(`🔍 验证进度: ${confirmed}/${total} (${percentage}%) - ${status.overallStatus}`);
            }
        };
        // 执行验证
        console.log(`🔍 开始验证链条...`);
        const verificationResult = await (0, transactionBuilder_1.verifyExistingChain)({
            parentTxId: options.parentTx,
            childTxIds,
            contractId,
            finalReceiverAddress: options.receiver,
            provider,
            verificationConfig
        });
        // 显示结果
        console.log(`\n🎯 验证完成！`);
        console.log((0, chainVerification_1.formatVerificationResult)(verificationResult));
        // 最终状态
        if (verificationResult.overallStatus === 'completed' &&
            verificationResult.finalAssetBalance?.verified) {
            console.log(`\n🎉 链条验证成功！`);
            console.log(`   所有 ${childTxIds.length} 笔子交易已确认`);
            console.log(`   接收地址包含期望的 alkane tokens`);
            console.log(`\n💡 Project Snowball 执行完全成功！`);
        }
        else {
            console.log(`\n⚠️  验证发现问题：`);
            if (verificationResult.overallStatus !== 'completed') {
                console.log(`   - 交易确认状态: ${verificationResult.overallStatus}`);
            }
            if (verificationResult.finalAssetBalance && !verificationResult.finalAssetBalance.verified) {
                console.log(`   - 资产余额不匹配`);
            }
        }
    }
    catch (error) {
        console.error(`\n💥 Chain Verification Failed:`);
        if (error instanceof chainMinting_1.ChainMintingError) {
            console.error(`   Error Type: ${error.type}`);
            console.error(`   Message: ${error.message}`);
            if (error.details && options.verbose) {
                console.error(`   Details:`, JSON.stringify(error.details, null, 2));
            }
        }
        else {
            console.error(`   ${error.message}`);
            if (options.verbose) {
                console.error(`   Stack:`, error.stack);
            }
        }
        console.error(`\n💡 Troubleshooting tips:`);
        console.error(`   1. Verify all transaction IDs are correct and exist on-chain`);
        console.error(`   2. Check that the contract ID is valid`);
        console.error(`   3. Ensure sufficient time for transaction confirmations`);
        console.error(`   4. Use --verbose for more detailed information`);
        process.exit(1);
    }
});
//# sourceMappingURL=alkane.js.map