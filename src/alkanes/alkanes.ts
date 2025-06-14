import { minimumFee } from '../btc'
import { Provider } from '../provider/provider'
import * as bitcoin from 'bitcoinjs-lib'
import {
  encipher,
  encodeRunestoneProtostone,
  p2tr_ord_reveal,
  ProtoStone,
} from 'alkanes/lib/index'
import { ProtoruneEdict } from 'alkanes/lib/protorune/protoruneedict'
import { Account, AlkaneId, Signer, mnemonicToAccount, getWalletPrivateKeys } from '..'
import {
  findXAmountOfSats,
  formatInputsToSign,
  getOutputValueByVOutIndex,
  getVSize,
  inscriptionSats,
  tweakSigner,
} from '../shared/utils'
import { getEstimatedFee } from '../psbt'
import { OylTransactionError } from '../errors'
import { AlkanesPayload } from '../shared/interface'
import { getAddressType } from '../shared/utils'
import { toXOnly } from 'bitcoinjs-lib/src/psbt/bip371'
import { LEAF_VERSION_TAPSCRIPT } from 'bitcoinjs-lib/src/payments/bip341'
import { actualDeployCommitFee } from './contract'
import { selectSpendableUtxos, accountUtxos, type FormattedUtxo } from '../utxo'

export interface ProtostoneMessage {
  protocolTag?: bigint
  edicts?: ProtoruneEdict[]
  pointer?: number
  refundPointer?: number
  calldata: bigint[]
}

export const encodeProtostone = ({
  protocolTag = 1n,
  edicts = [],
  pointer = 0,
  refundPointer = 0,
  calldata,
}: ProtostoneMessage) => {
  return encodeRunestoneProtostone({
    protostones: [
      ProtoStone.message({
        protocolTag,
        edicts,
        pointer,
        refundPointer,
        calldata: encipher(calldata),
      }),
    ],
  }).encodedRunestone
}

export const createExecutePsbt = async ({
  alkanesUtxos,
  frontendFee,
  feeAddress,
  utxos,
  account,
  protostone,
  provider,
  feeRate,
  fee = 0,
  alkaneReceiverAddress,
  enableRBF = false,
  noChange = false,
}: {
  alkanesUtxos?: FormattedUtxo[]
  frontendFee?: bigint
  feeAddress?: string
  utxos: FormattedUtxo[]
  account: Account
  protostone: Buffer
  provider: Provider
  feeRate?: number
  fee?: number
  alkaneReceiverAddress?: string
  enableRBF?: boolean
  noChange?: boolean
}) => {
  try {
    const SAT_PER_VBYTE = feeRate ?? 1
    const MIN_RELAY = 546n

    if (frontendFee && !feeAddress) {
      throw new Error('feeAddress required when frontendFee is set')
    }

    const feeSatEffective: bigint =
      frontendFee && frontendFee >= MIN_RELAY ? frontendFee : 0n

    const spendTargets = inscriptionSats + Number(feeSatEffective)

    const minTxSize = minimumFee({
      taprootInputCount: 1,
      nonTaprootInputCount: 0,
      outputCount: 2 + (feeSatEffective > 0n ? 1 : 0),
    })

    const minFee = minTxSize * SAT_PER_VBYTE
    let minerFee = fee === 0 ? minFee : fee

    let gatheredUtxos = {
      utxos: utxos,
      totalAmount: utxos.reduce((acc, utxo) => acc + utxo.satoshis, 0),
    }

    const satsNeeded = spendTargets + minerFee
    gatheredUtxos = findXAmountOfSats(gatheredUtxos.utxos, satsNeeded)

    if (fee === 0 && gatheredUtxos.utxos.length > 1) {
      const newSize = minimumFee({
        taprootInputCount: gatheredUtxos.utxos.length,
        nonTaprootInputCount: 0,
        outputCount: 2 + (feeSatEffective > 0n ? 1 : 0),
      })
      minerFee = newSize * SAT_PER_VBYTE
      if (gatheredUtxos.totalAmount < minerFee) {
        throw new OylTransactionError(Error('Insufficient balance'))
      }
    }

    const psbt = new bitcoin.Psbt({ network: provider.network })

    if (alkanesUtxos) {
      for (const utxo of alkanesUtxos) {
        await addInputForUtxo(psbt, utxo, account, provider, enableRBF)
      }
    }
    for (const utxo of gatheredUtxos.utxos) {
      await addInputForUtxo(psbt, utxo, account, provider, enableRBF)
    }

    psbt.addOutput({ 
      address: alkaneReceiverAddress || account.taproot.address, 
      value: inscriptionSats 
    })
    psbt.addOutput({ script: protostone, value: 0 })

    if (feeSatEffective > 0n) {
      psbt.addOutput({
        address: feeAddress!,
        value: Number(feeSatEffective),
      })
    }

    const totalAlkanesAmount = alkanesUtxos
      ? alkanesUtxos.reduce((acc, utxo) => acc + utxo.satoshis, 0)
      : 0

    const inputsTotal = gatheredUtxos.totalAmount + (totalAlkanesAmount ?? 0)
    const outputsTotal = psbt.txOutputs.reduce((sum, o) => sum + o.value, 0)

    let change = inputsTotal - outputsTotal - minerFee + 14
    if (change < 0) throw new OylTransactionError(Error('Insufficient balance'))

    if (noChange !== true && change >= Number(MIN_RELAY)) {
      psbt.addOutput({
        address: account[account.spendStrategy.changeAddress].address,
        value: change,
      })
    } else {
      minerFee += change
      change = 0
    }

    const formatted = await formatInputsToSign({
      _psbt: psbt,
      senderPublicKey: account.taproot.pubkey,
      network: provider.network,
    })

    return {
      psbt: formatted.toBase64(),
      psbtHex: formatted.toHex(),
    }
  } catch (err) {
    throw new OylTransactionError(err)
  }
}

async function addInputForUtxo(
  psbt: bitcoin.Psbt,
  utxo: FormattedUtxo,
  account: Account,
  provider: Provider,
  enableRBF: boolean = false
) {
  // Set sequence for RBF: 0xfffffffd enables RBF, 0xffffffff disables it
  const sequence = enableRBF ? 0xfffffffd : 0xffffffff
  
  const type = getAddressType(utxo.address)
  switch (type) {
    case 0: {
      // legacy P2PKH
      const prevHex = await provider.esplora.getTxHex(utxo.txId)
      psbt.addInput({
        hash: utxo.txId,
        index: +utxo.outputIndex,
        nonWitnessUtxo: Buffer.from(prevHex, 'hex'),
        sequence: sequence,
      })
      break
    }
    case 2: {
      // nested SegWit
      const redeem = bitcoin.script.compile([
        bitcoin.opcodes.OP_0,
        bitcoin.crypto.hash160(Buffer.from(account.nestedSegwit.pubkey, 'hex')),
      ])
      psbt.addInput({
        hash: utxo.txId,
        index: +utxo.outputIndex,
        redeemScript: redeem,
        sequence: sequence,
        witnessUtxo: {
          value: utxo.satoshis,
          script: bitcoin.script.compile([
            bitcoin.opcodes.OP_HASH160,
            bitcoin.crypto.hash160(redeem),
            bitcoin.opcodes.OP_EQUAL,
          ]),
        },
      })
      break
    }
    case 1: // native P2WPKH
    case 3: // P2TR
    default: {
      psbt.addInput({
        hash: utxo.txId,
        index: +utxo.outputIndex,
        sequence: sequence,
        witnessUtxo: {
          value: utxo.satoshis,
          script: Buffer.from(utxo.scriptPk, 'hex'),
        },
      })
    }
  }
}

export const createDeployCommitPsbt = async ({
  payload,
  utxos,
  tweakedPublicKey,
  account,
  provider,
  feeRate,
  fee,
}: {
  payload: AlkanesPayload
  utxos: FormattedUtxo[]
  tweakedPublicKey: string
  account: Account
  provider: Provider
  feeRate?: number
  fee?: number
}) => {
  try {
    let gatheredUtxos = selectSpendableUtxos(utxos, account.spendStrategy)

    const minFee = minimumFee({
      taprootInputCount: 2,
      nonTaprootInputCount: 0,
      outputCount: 2,
    })
    const calculatedFee = minFee * feeRate < 250 ? 250 : minFee * feeRate
    let finalFee = fee ? fee : calculatedFee

    let psbt = new bitcoin.Psbt({ network: provider.network })

    const script = Buffer.from(
      p2tr_ord_reveal(toXOnly(Buffer.from(tweakedPublicKey, 'hex')), [payload])
        .script
    )

    const inscriberInfo = bitcoin.payments.p2tr({
      internalPubkey: toXOnly(Buffer.from(tweakedPublicKey, 'hex')),
      scriptTree: {
        output: script,
      },
      network: provider.network,
    })

    const wasmDeploySize = getVSize(Buffer.from(payload.body)) * feeRate

    gatheredUtxos = findXAmountOfSats(
      [...utxos],
      wasmDeploySize + Number(inscriptionSats) + finalFee * 2
    )

    if (!fee && gatheredUtxos.utxos.length > 1) {
      const txSize = minimumFee({
        taprootInputCount: gatheredUtxos.utxos.length,
        nonTaprootInputCount: 0,
        outputCount: 2,
      })
      finalFee = txSize * feeRate < 250 ? 250 : txSize * feeRate

      if (gatheredUtxos.totalAmount < finalFee) {
        gatheredUtxos = findXAmountOfSats(
          [...utxos],
          wasmDeploySize + Number(inscriptionSats) + finalFee * 2
        )
      }
    }

    for (let i = 0; i < gatheredUtxos.utxos.length; i++) {
      if (getAddressType(gatheredUtxos.utxos[i].address) === 0) {
        const previousTxHex: string = await provider.esplora.getTxHex(
          gatheredUtxos.utxos[i].txId
        )
        psbt.addInput({
          hash: gatheredUtxos.utxos[i].txId,
          index: gatheredUtxos.utxos[i].outputIndex,
          nonWitnessUtxo: Buffer.from(previousTxHex, 'hex'),
        })
      }
      if (getAddressType(gatheredUtxos.utxos[i].address) === 2) {
        const redeemScript = bitcoin.script.compile([
          bitcoin.opcodes.OP_0,
          bitcoin.crypto.hash160(
            Buffer.from(account.nestedSegwit.pubkey, 'hex')
          ),
        ])

        psbt.addInput({
          hash: gatheredUtxos.utxos[i].txId,
          index: gatheredUtxos.utxos[i].outputIndex,
          redeemScript: redeemScript,
          witnessUtxo: {
            value: gatheredUtxos.utxos[i].satoshis,
            script: bitcoin.script.compile([
              bitcoin.opcodes.OP_HASH160,
              bitcoin.crypto.hash160(redeemScript),
              bitcoin.opcodes.OP_EQUAL,
            ]),
          },
        })
      }
      if (
        getAddressType(gatheredUtxos.utxos[i].address) === 1 ||
        getAddressType(gatheredUtxos.utxos[i].address) === 3
      ) {
        psbt.addInput({
          hash: gatheredUtxos.utxos[i].txId,
          index: gatheredUtxos.utxos[i].outputIndex,
          witnessUtxo: {
            value: gatheredUtxos.utxos[i].satoshis,
            script: Buffer.from(gatheredUtxos.utxos[i].scriptPk, 'hex'),
          },
        })
      }
    }

    if (
      gatheredUtxos.totalAmount <
      finalFee * 2 + inscriptionSats + wasmDeploySize
    ) {
      throw new OylTransactionError(Error('Insufficient Balance'))
    }

    psbt.addOutput({
      value: finalFee + wasmDeploySize + inscriptionSats,
      address: inscriberInfo.address,
    })

    const changeAmount =
      gatheredUtxos.totalAmount -
      (finalFee * 2 + wasmDeploySize + inscriptionSats)

    psbt.addOutput({
      address: account[account.spendStrategy.changeAddress].address,
      value: changeAmount,
    })

    const formattedPsbtTx = await formatInputsToSign({
      _psbt: psbt,
      senderPublicKey: account.taproot.pubkey,
      network: provider.network,
    })

    return { psbt: formattedPsbtTx.toBase64(), script }
  } catch (error) {
    throw new OylTransactionError(error)
  }
}

export const deployCommit = async ({
  payload,
  utxos,
  account,
  provider,
  feeRate,
  signer,
}: {
  payload: AlkanesPayload
  utxos: FormattedUtxo[]
  account: Account
  provider: Provider
  feeRate?: number
  signer: Signer
}) => {
  const tweakedTaprootKeyPair: bitcoin.Signer = tweakSigner(
    signer.taprootKeyPair,
    {
      network: provider.network,
    }
  )

  const tweakedPublicKey = tweakedTaprootKeyPair.publicKey.toString('hex')

  const { fee: commitFee } = await actualDeployCommitFee({
    payload,
    utxos,
    tweakedPublicKey,
    account,
    provider,
    feeRate,
  })

  const { psbt: finalPsbt, script } = await createDeployCommitPsbt({
    payload,
    utxos,
    tweakedPublicKey,
    account,
    provider,
    feeRate,
    fee: commitFee,
  })

  const { signedPsbt } = await signer.signAllInputs({
    rawPsbt: finalPsbt,
    finalize: true,
  })

  const result = await provider.pushPsbt({
    psbtBase64: signedPsbt,
  })

  return { ...result, script: script.toString('hex') }
}

export const createDeployRevealPsbt = async ({
  protostone,
  receiverAddress,
  script,
  feeRate,
  tweakedPublicKey,
  provider,
  fee = 0,
  commitTxId,
}: {
  protostone: Buffer
  receiverAddress: string
  script: Buffer
  feeRate: number
  tweakedPublicKey: string
  provider: Provider
  fee?: number
  commitTxId: string
}) => {
  try {
    if (!feeRate) {
      feeRate = (await provider.esplora.getFeeEstimates())['1']
    }

    const psbt: bitcoin.Psbt = new bitcoin.Psbt({ network: provider.network })
    const minFee = minimumFee({
      taprootInputCount: 1,
      nonTaprootInputCount: 0,
      outputCount: 2,
    })

    const revealTxBaseFee = minFee * feeRate < 250 ? 250 : minFee * feeRate
    const revealTxChange = fee === 0 ? 0 : Number(revealTxBaseFee) - fee

    const commitTxOutput = await getOutputValueByVOutIndex({
      txId: commitTxId,
      vOut: 0,
      esploraRpc: provider.esplora,
    })

    if (!commitTxOutput) {
      throw new OylTransactionError(new Error('Error getting vin #0 value'))
    }

    const p2pk_redeem = { output: script }

    const { output, witness } = bitcoin.payments.p2tr({
      internalPubkey: toXOnly(Buffer.from(tweakedPublicKey, 'hex')),
      scriptTree: p2pk_redeem,
      redeem: p2pk_redeem,
      network: provider.network,
    })

    psbt.addInput({
      hash: commitTxId,
      index: 0,
      witnessUtxo: {
        value: commitTxOutput.value,
        script: output,
      },
      tapLeafScript: [
        {
          leafVersion: LEAF_VERSION_TAPSCRIPT,
          script: p2pk_redeem.output,
          controlBlock: witness![witness!.length - 1],
        },
      ],
    })

    psbt.addOutput({
      value: inscriptionSats,
      address: receiverAddress,
    })

    psbt.addOutput({
      value: 0,
      script: protostone,
    })

    if (revealTxChange > inscriptionSats) {
      psbt.addOutput({
        value: revealTxChange,
        address: receiverAddress,
      })
    }

    return {
      psbt: psbt.toBase64(),
      fee: revealTxChange,
    }
  } catch (error) {
    throw new OylTransactionError(error)
  }
}

export const deployReveal = async ({
  protostone,
  commitTxId,
  script,
  account,
  provider,
  feeRate,
  signer,
}: {
  protostone: Buffer
  commitTxId: string
  script: string
  account: Account
  provider: Provider
  feeRate?: number
  signer: Signer
}) => {
  const tweakedTaprootKeyPair: bitcoin.Signer = tweakSigner(
    signer.taprootKeyPair,
    {
      network: provider.network,
    }
  )

  const tweakedPublicKey = tweakedTaprootKeyPair.publicKey.toString('hex')

  const { fee } = await actualTransactRevealFee({
    protostone,
    tweakedPublicKey,
    receiverAddress: account.taproot.address,
    commitTxId,
    script: Buffer.from(script, 'hex'),
    provider,
    feeRate,
  })

  const { psbt: finalRevealPsbt } = await createTransactReveal({
    protostone,
    tweakedPublicKey,
    receiverAddress: account.taproot.address,
    commitTxId,
    script: Buffer.from(script, 'hex'),
    provider,
    feeRate,
    fee,
  })

  let finalReveal = bitcoin.Psbt.fromBase64(finalRevealPsbt, {
    network: provider.network,
  })

  finalReveal.signInput(0, tweakedTaprootKeyPair)
  finalReveal.finalizeInput(0)

  const finalSignedPsbt = finalReveal.toBase64()

  const revealResult = await provider.pushPsbt({
    psbtBase64: finalSignedPsbt,
  })

  return revealResult
}

export const actualTransactRevealFee = async ({
  protostone,
  tweakedPublicKey,
  commitTxId,
  receiverAddress,
  script,
  provider,
  feeRate,
}: {
  protostone: Buffer
  tweakedPublicKey: string
  commitTxId: string
  receiverAddress: string
  script: Buffer
  provider: Provider
  feeRate?: number
}) => {
  if (!feeRate) {
    feeRate = (await provider.esplora.getFeeEstimates())['1']
  }

  const { psbt } = await createTransactReveal({
    protostone,
    commitTxId,
    receiverAddress,
    script,
    tweakedPublicKey,
    provider,
    feeRate,
  })

  const { fee: estimatedFee } = await getEstimatedFee({
    feeRate,
    psbt,
    provider,
  })

  const { psbt: finalPsbt } = await createTransactReveal({
    protostone,
    commitTxId,
    receiverAddress,
    script,
    tweakedPublicKey,
    provider,
    feeRate,
    fee: estimatedFee,
  })

  const { fee: finalFee, vsize } = await getEstimatedFee({
    feeRate,
    psbt: finalPsbt,
    provider,
  })

  return { fee: finalFee, vsize }
}

export const actualExecuteFee = async ({
  alkanesUtxos,
  utxos,
  account,
  protostone,
  provider,
  feeRate,
  frontendFee,
  feeAddress,
  alkaneReceiverAddress,
  noChange = false,
}: {
  alkanesUtxos?: FormattedUtxo[]
  utxos: FormattedUtxo[]
  account: Account
  protostone: Buffer
  provider: Provider
  feeRate: number
  frontendFee?: bigint
  feeAddress?: string
  alkaneReceiverAddress?: string
  noChange?: boolean
}) => {
  const { psbt } = await createExecutePsbt({
    alkanesUtxos,
    frontendFee,
    feeAddress,
    utxos,
    account,
    protostone,
    provider,
    feeRate,
    alkaneReceiverAddress,
    enableRBF: false,
    noChange,
  })

  const { fee: estimatedFee } = await getEstimatedFee({
    feeRate,
    psbt,
    provider,
  })

  const { psbt: finalPsbt } = await createExecutePsbt({
    alkanesUtxos,
    frontendFee,
    feeAddress,
    utxos,
    account,
    protostone,
    provider,
    feeRate,
    fee: estimatedFee,
    alkaneReceiverAddress,
    enableRBF: false,
    noChange,
  })

  const { fee: finalFee, vsize } = await getEstimatedFee({
    feeRate,
    psbt: finalPsbt,
    provider,
  })

  return { fee: finalFee, vsize }
}

export const executePsbt = async ({
  alkanesUtxos,
  utxos,
  account,
  protostone,
  provider,
  feeRate,
  frontendFee,
  feeAddress,
  alkaneReceiverAddress,
}: {
  alkanesUtxos?: FormattedUtxo[]
  utxos: FormattedUtxo[]
  account: Account
  protostone: Buffer
  provider: Provider
  feeRate?: number
  frontendFee?: bigint
  feeAddress?: string
  alkaneReceiverAddress?: string
}) => {
  const { fee } = await actualExecuteFee({
    alkanesUtxos,
    frontendFee,
    feeAddress,
    utxos,
    account,
    protostone,
    provider,
    feeRate,
    alkaneReceiverAddress,
  })

  const { psbt: finalPsbt } = await createExecutePsbt({
    alkanesUtxos,
    frontendFee,
    feeAddress,
    utxos,
    account,
    protostone,
    provider,
    feeRate,
    fee,
    alkaneReceiverAddress,
    enableRBF: false,
  })

  return { psbt: finalPsbt, fee }
}

export const execute = async ({
  alkanesUtxos,
  utxos,
  account,
  protostone,
  provider,
  feeRate,
  signer,
  frontendFee,
  feeAddress,
  alkaneReceiverAddress,
  enableRBF = false,
  noChange = false,
}: {
  alkanesUtxos?: FormattedUtxo[]
  utxos: FormattedUtxo[]
  account: Account
  protostone: Buffer
  provider: Provider
  feeRate?: number
  signer: Signer
  frontendFee?: bigint
  feeAddress?: string
  alkaneReceiverAddress?: string
  enableRBF?: boolean
  noChange?: boolean
}) => {
  const { fee } = await actualExecuteFee({
    alkanesUtxos,
    frontendFee,
    feeAddress,
    utxos,
    account,
    protostone,
    provider,
    feeRate,
    alkaneReceiverAddress,
    noChange,
  })

  const { psbt: finalPsbt } = await createExecutePsbt({
    alkanesUtxos,
    frontendFee,
    feeAddress,
    utxos,
    account,
    protostone,
    provider,
    feeRate,
    fee,
    alkaneReceiverAddress,
    enableRBF,
    noChange,
  })

  const { signedPsbt } = await signer.signAllInputs({
    rawPsbt: finalPsbt,
    finalize: true,
  })

  const pushResult = await provider.pushPsbt({
    psbtBase64: signedPsbt,
  })

  return pushResult
}

export const createTransactReveal = async ({
  protostone,
  receiverAddress,
  script,
  feeRate,
  tweakedPublicKey,
  provider,
  fee = 0,
  commitTxId,
}: {
  protostone: Buffer
  receiverAddress: string
  script: Buffer
  feeRate: number
  tweakedPublicKey: string
  provider: Provider
  fee?: number
  commitTxId: string
}) => {
  try {
    if (!feeRate) {
      feeRate = (await provider.esplora.getFeeEstimates())['1']
    }

    const psbt: bitcoin.Psbt = new bitcoin.Psbt({ network: provider.network })
    const minFee = minimumFee({
      taprootInputCount: 1,
      nonTaprootInputCount: 0,
      outputCount: 2,
    })

    const revealTxBaseFee = minFee * feeRate < 250 ? 250 : minFee * feeRate
    const revealTxChange = fee === 0 ? 0 : Number(revealTxBaseFee) - fee

    const commitTxOutput = await getOutputValueByVOutIndex({
      txId: commitTxId,
      vOut: 0,
      esploraRpc: provider.esplora,
    })

    if (!commitTxOutput) {
      throw new OylTransactionError(new Error('Error getting vin #0 value'))
    }

    const p2pk_redeem = { output: script }

    const { output, witness } = bitcoin.payments.p2tr({
      internalPubkey: toXOnly(Buffer.from(tweakedPublicKey, 'hex')),
      scriptTree: p2pk_redeem,
      redeem: p2pk_redeem,
      network: provider.network,
    })

    psbt.addInput({
      hash: commitTxId,
      index: 0,
      witnessUtxo: {
        value: commitTxOutput.value,
        script: output,
      },
      tapLeafScript: [
        {
          leafVersion: LEAF_VERSION_TAPSCRIPT,
          script: p2pk_redeem.output,
          controlBlock: witness![witness!.length - 1],
        },
      ],
    })

    psbt.addOutput({
      value: inscriptionSats,
      address: receiverAddress,
    })

    psbt.addOutput({
      value: 0,
      script: protostone,
    })

    if (revealTxChange > inscriptionSats) {
      psbt.addOutput({
        value: revealTxChange,
        address: receiverAddress,
      })
    }

    return {
      psbt: psbt.toBase64(),
      fee: revealTxChange,
    }
  } catch (error) {
    throw new OylTransactionError(error)
  }
}

export const toTxId = (rawLeTxid: string) =>
  Buffer.from(rawLeTxid, 'hex').reverse().toString('hex')


export const batchExecute = async ({
  alkanesUtxos,
  utxos,
  account,
  protostone,
  provider,
  feeRate,
  signer,
  frontendFee,
  feeAddress,
  accountCount,
  mnemonic,
  alkaneReceiverAddress,
}: {
  alkanesUtxos?: FormattedUtxo[]
  utxos: FormattedUtxo[]
  account: Account
  protostone: Buffer
  provider: Provider
  feeRate?: number
  signer: Signer
  frontendFee?: bigint
  feeAddress?: string
  accountCount: number
  mnemonic: string
  alkaneReceiverAddress?: string
}) => {
  try {
    if (accountCount < 1) {
      throw new Error('Account count must be at least 1')
    }

    // Generate child accounts and their corresponding signers (excluding main account)
    const accountsWithSigners: Array<{ account: Account; signer: Signer }> = []
    
    for (let i = 1; i <= accountCount; i++) {
      const childAccount = mnemonicToAccount({
        mnemonic,
        opts: {
          network: account.network,
          index: i,
          spendStrategy: account.spendStrategy,
        },
      })
      
      // Create a signer for this child account
      const childPrivateKeys = getWalletPrivateKeys({
        mnemonic,
        opts: {
          network: account.network,
          index: i,
        },
      })
      
      const childSigner = new Signer(account.network, {
        taprootPrivateKey: childPrivateKeys.taproot.privateKey,
        segwitPrivateKey: childPrivateKeys.nativeSegwit.privateKey,
        nestedSegwitPrivateKey: childPrivateKeys.nestedSegwit.privateKey,
        legacyPrivateKey: childPrivateKeys.legacy.privateKey,
      })
      
      accountsWithSigners.push({ account: childAccount, signer: childSigner })
    }

    // Execute with each account and its corresponding signer concurrently
    const executePromises = accountsWithSigners.map(async ({ account: acc, signer: accSigner }, index) => {
      try {
        // Get UTXOs for this specific account instead of using shared UTXOs
        const { accountUtxos: accUtxos } = await accountUtxos({
          account: acc,
          provider,
        })
        
        const result = await execute({
          alkanesUtxos,
          utxos: accUtxos,
          account: acc,
          protostone,
          provider,
          feeRate,
          signer: accSigner,
          frontendFee,
          feeAddress,
          alkaneReceiverAddress,
        })
        return {
          account: {
            index: index + 1, // Child account index starts from 1
            address: acc.taproot.address,
          },
          success: true,
          result,
        }
      } catch (error) {
        return {
          account: {
            index: index + 1, // Child account index starts from 1
            address: acc.taproot.address,
          },
          success: false,
          error: error.message,
        }
      }
    })

    const results = await Promise.allSettled(executePromises)

    const executionResults = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value
      } else {
        return {
          account: {
            index: index + 1, // Child account index starts from 1
            address: accountsWithSigners[index].account.taproot.address,
          },
          success: false,
          error: result.reason?.message || 'Unknown error',
        }
      }
    })

    const successfulExecutions = executionResults.filter((r) => r.success)
    const failedExecutions = executionResults.filter((r) => !r.success)

    return {
      totalAccounts: accountCount,
      successfulExecutions: successfulExecutions.length,
      failedExecutions: failedExecutions.length,
      results: executionResults,
      summary: {
        success: successfulExecutions.map((r) => ({
          accountIndex: r.account.index,
          address: r.account.address,
          txId: r.result?.txId,
        })),
        failed: failedExecutions.map((r) => ({
          accountIndex: r.account.index,
          address: r.account.address,
          error: r.error,
        })),
      },
    }
  } catch (error) {
    throw new OylTransactionError(error)
  }
}
