import { Command } from 'commander';
import { AlkaneContractId } from '../alkanes/chainMinting';
export declare class AlkanesCommand extends Command {
    constructor(cmd: any);
    action(fn: any): this;
}
export declare const alkanesTrace: AlkanesCommand;
export declare const alkaneContractDeploy: AlkanesCommand;
export declare const alkaneTokenDeploy: AlkanesCommand;
export declare const alkaneExecute: AlkanesCommand;
export declare const alkaneRemoveLiquidity: AlkanesCommand;
export declare const alkaneSwap: AlkanesCommand;
export declare const alkaneSend: AlkanesCommand;
export declare const alkaneCreatePool: AlkanesCommand;
export declare const alkaneAddLiquidity: AlkanesCommand;
export declare const alkaneSimulate: AlkanesCommand;
export declare const alkaneGetAllPoolsDetails: AlkanesCommand;
export declare const alkanePreviewRemoveLiquidity: AlkanesCommand;
export declare const alkaneList: AlkanesCommand;
export declare const alkaneBatchExecute: AlkanesCommand;
export declare const alkaneEstimateFee: AlkanesCommand;
export declare const alkaneChainMint: AlkanesCommand;
export declare function executeParallelChainMinting_CLI({ options, contractId, totalMints, feeRate, provider, wallet }: {
    options: any;
    contractId: AlkaneContractId;
    totalMints: number;
    feeRate: number;
    provider: any;
    wallet: any;
}): Promise<void>;
export declare const alkaneVerifyChain: AlkanesCommand;
