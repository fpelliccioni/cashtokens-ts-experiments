// --------------------------------------------------------------------------------------
// Auliliary/Helper code
// --------------------------------------------------------------------------------------

export interface ReadPosition {
  /**
   * The `Uint8Array` from which bytes are being read.
   */
  bin: Uint8Array;
  /**
   * The index at which the next byte should be read.
   */
  index: number;
}

/**
 * The successful result of a read function, includes the result and the next
 * {@link ReadPosition}.
 */
export interface ReadResult<Type> {
  /**
   * The new read position after the successfully-read bytes.
   */
  position: ReadPosition;
  /**
   * The successfully-read value.
   */
  result: Type;
}

/**
 * The return type of a read function that may fail. May be a {@link ReadResult}
 * or an error message (string).
 */
export type MaybeReadResult<Type> = ReadResult<Type> | string;

/**
 * A simple method used throughout Libauth to format error messages. By
 * formatting errors this way, downstream consumers can detect specific error
 * types by matching the `errorType`. For example, the error:
 *
 * ```ts
 * formatError(SomeTypeOfError.exceedsMaximum, `Provided value: ${value}`);
 * ```
 *
 * Can be detected with `String.includes()`, even if the
 * `SomeTypeOfError.exceedsMaximum` error message changes:
 * ```ts
 * error.includes(SomeTypeOfError.exceedsMaximum);
 * // => true
 * ```
 *
 * Using this method ensures consistency across the library.
 *
 * @remarks
 * In Libauth, expected errors use the type `string` rather than `Error` (or
 * other objects that inherit from `Error`) to simplify the resulting types and
 * typechecking requirements. This ensures consistency of returned errors in all
 * environments, avoids exposing internal details like stack traces and line
 * numbers, and allows error messages to be recorded or used as text without an
 * intermediate `toString()` method.
 *
 * @param errorType - the error enum member representing this error type
 * @param errorDetails - optional, additional details to include in the error
 * message
 */
export const formatError = (errorType: string, errorDetails?: string) =>
  `${errorType}${errorDetails === undefined ? '' : ` ${errorDetails}`}`;

// const unknownValue = (
//   value: never,
//   message = `Received an unknown value: ${String(
//     value
//   )}. This should have been caught by TypeScript - are your types correct?`
// ) => {
//   // eslint-disable-next-line functional/no-throw-statement
//   throw new Error(message);
// };

export enum CompactUintError {
  noPrefix = 'Error reading CompactUint: requires at least one byte.',
  insufficientBytes = 'Error reading CompactUint: insufficient bytes.',
  nonMinimal = 'Error reading CompactUint: CompactUint is not minimally encoded.',
  excessiveBytes = 'Error decoding CompactUint: unexpected bytes after CompactUint.',
}

export const enum CompactUint {
  uint8MaxValue = 0xfc,
  uint16Prefix = 0xfd,
  uint16MaxValue = 0xffff,
  uint32Prefix = 0xfe,
  uint32MaxValue = 0xffffffff,
  uint64Prefix = 0xff,
  uint8 = 1,
  uint16 = 2,
  uint32 = 4,
  uint64 = 8,
}

/**
 * Get the expected byte length of a CompactUint given a first byte.
 *
 * @param firstByte - the first byte of the CompactUint
 */
export const compactUintPrefixToSize = (firstByte: number) => {
  switch (firstByte) {
    case CompactUint.uint16Prefix:
      return CompactUint.uint16 + 1;
    case CompactUint.uint32Prefix:
      return CompactUint.uint32 + 1;
    case CompactUint.uint64Prefix:
      return CompactUint.uint64 + 1;
    default:
      return CompactUint.uint8;
  }
};

/**
 * Decode a little-endian Uint8Array of any length into a BigInt.
 *
 * The `bytes` parameter can be set to constrain the expected length (default:
 * `bin.length`). This method throws if `bin.length` is not equal to `bytes`.
 *
 * @param bin - the Uint8Array to decode
 * @param bytes - the number of bytes to read (default: `bin.length`)
 */
export const binToBigIntUintLE = (bin: Uint8Array, bytes = bin.length) => {
  const bitsInAByte = 8;

  if (bin.length !== bytes) {
    /// eslint-disable-next-line functional/no-throw-statement
    throw new TypeError(`Bin length must be ${bytes}.`);
  }
  return new Uint8Array(bin.buffer, bin.byteOffset, bin.length).reduceRight(
    // eslint-disable-next-line no-bitwise
    (accumulated, byte) => (accumulated << BigInt(bitsInAByte)) | BigInt(byte),
    0n,
  );
};

/**
 * Read a non-minimally-encoded `CompactUint` (see {@link bigIntToCompactUint})
 * from the provided {@link ReadPosition}, returning either an error message (as
 * a string) or an object containing the value and the
 * next {@link ReadPosition}.
 *
 * Rather than this function, most applications should
 * use {@link readCompactUintMinimal}.
 *
 * @param position - the {@link ReadPosition} at which to start reading the
 * `CompactUint`
 */
export const readCompactUint = (
  position: ReadPosition,
): MaybeReadResult<bigint> => {
  const { bin, index } = position;
  const prefix = bin[index];
  if (prefix === undefined) {
    return formatError(CompactUintError.noPrefix);
  }
  const bytes = compactUintPrefixToSize(prefix);
  if (bin.length - index < bytes) {
    return formatError(
      CompactUintError.insufficientBytes,
      `CompactUint prefix ${prefix} requires at least ${bytes} bytes. Remaining bytes: ${
        bin.length - index
      }`,
    );
  }
  const hasPrefix = bytes !== 1;
  const contents = hasPrefix
    ? bin.subarray(index + 1, index + bytes)
    : bin.subarray(index, index + bytes);

  return {
    position: { bin, index: index + bytes },
    result: binToBigIntUintLE(contents),
  };
};

/**
 * Encode a positive integer as a 2-byte Uint16LE Uint8Array.
 *
 * This method will return an incorrect result for values outside of the range
 * `0` to `0xffff` (`65535`). If applicable, applications should handle such
 * cases prior to calling this method.
 *
 * @param value - the number to encode
 */
export const numberToBinUint16LE = (value: number) => {
  const uint16Length = 2;
  const bin = new Uint8Array(uint16Length);
  const writeAsLittleEndian = true;
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  /// eslint-disable-next-line functional/no-expression-statement
  view.setUint16(0, value, writeAsLittleEndian);
  return bin;
};

/**
 * Encode a positive number as a 4-byte Uint32LE Uint8Array.
 *
 * This method will return an incorrect result for values outside of the range
 * `0` to `0xffffffff` (`4294967295`). If applicable, applications should handle
 * such cases prior to calling this method.
 *
 * @param value - the number to encode
 */
export const numberToBinUint32LE = (value: number) => {
  const uint32Length = 4;
  const bin = new Uint8Array(uint32Length);
  const writeAsLittleEndian = true;
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  /// eslint-disable-next-line functional/no-expression-statement
  view.setUint32(0, value, writeAsLittleEndian);
  return bin;
};

/**
 * Encode a positive BigInt as little-endian Uint8Array. Negative values will
 * return the same result as `0`.
 *
 * @param value - the number to encode
 */
export const bigIntToBinUintLE = (value: bigint) => {
  const baseUint8Array = 256;
  const base = BigInt(baseUint8Array);
  const result: number[] = [];
  /// eslint-disable-next-line functional/no-let
  let remaining = value;
  /// eslint-disable-next-line functional/no-loop-statement
  while (remaining >= base) {
    /// eslint-disable-next-line functional/no-expression-statement, functional/immutable-data
    result.push(Number(remaining % base));
    /// eslint-disable-next-line functional/no-expression-statement
    remaining /= base;
  }
  /// eslint-disable-next-line functional/no-conditional-statement, functional/no-expression-statement, functional/immutable-data
  if (remaining > 0n) result.push(Number(remaining));

  return Uint8Array.from(result.length > 0 ? result : [0]);
};

/**
 * Fill a new Uint8Array of a specific byte-length with the contents of a given
 * Uint8Array, truncating or padding the Uint8Array with zeros.
 *
 * @param bin - the Uint8Array to resize
 * @param bytes - the desired byte-length
 */
export const binToFixedLength = (bin: Uint8Array, bytes: number) => {
  const fixedBytes = new Uint8Array(bytes);
  const maxValue = 255;
  /// eslint-disable-next-line functional/no-expression-statement
  bin.length > bytes ? fixedBytes.fill(maxValue) : fixedBytes.set(bin);
  return fixedBytes;
};

/**
 * Encode a positive BigInt as an 8-byte Uint64LE Uint8Array, clamping the
 * results – values exceeding `0xffff_ffff_ffff_ffff` (`18446744073709551615`)
 * return the same result as `0xffff_ffff_ffff_ffff`, negative values return the
 * same result as `0`.
 *
 * @param value - the number to encode
 */
export const bigIntToBinUint64LEClamped = (value: bigint) => {
  const uint64 = 8;
  return binToFixedLength(bigIntToBinUintLE(value), uint64);
};

/**
 * Encode a positive BigInt as an 8-byte Uint64LE Uint8Array.
 *
 * This method will return an incorrect result for values outside of the range
 * `0` to `0xffff_ffff_ffff_ffff` (`18446744073709551615`).
 *
 * @param value - the number to encode
 */
export const bigIntToBinUint64LE = (value: bigint) => {
  const uint64LengthInBits = 64;
  const valueAsUint64 = BigInt.asUintN(uint64LengthInBits, value);
  const fixedLengthBin = bigIntToBinUint64LEClamped(valueAsUint64);
  return fixedLengthBin;
};

/**
 * Encode a positive BigInt as a `CompactUint` (Satoshi's variable-length,
 * positive integer format).
 *
 * Note: the maximum value of a CompactUint is `0xffff_ffff_ffff_ffff`
 * (`18446744073709551615`). This method will return an incorrect result for
 * values outside of the range `0` to `0xffff_ffff_ffff_ffff`. If applicable,
 * applications should handle such cases prior to calling this method.
 *
 * @param value - the BigInt to encode (must be no larger than
 * `0xffff_ffff_ffff_ffff`)
 */
export const bigIntToCompactUint = (value: bigint) =>
  value <= BigInt(CompactUint.uint8MaxValue)
    ? Uint8Array.of(Number(value))
    : value <= BigInt(CompactUint.uint16MaxValue)
    ? Uint8Array.from([
        CompactUint.uint16Prefix,
        ...numberToBinUint16LE(Number(value)),
      ])
    : value <= BigInt(CompactUint.uint32MaxValue)
    ? Uint8Array.from([
        CompactUint.uint32Prefix,
        ...numberToBinUint32LE(Number(value)),
      ])
    : Uint8Array.from([
        CompactUint.uint64Prefix,
        ...bigIntToBinUint64LE(value),
      ]);

/**
 * Read a minimally-encoded `CompactUint` from the provided
 * {@link ReadPosition}, returning either an error message (as a string) or an
 * object containing the value and the next {@link ReadPosition}.
 *
 * @param position - the {@link ReadPosition} at which to start reading the
 * `CompactUint`
 */
export const readCompactUintMinimal = (
  position: ReadPosition,
): MaybeReadResult<bigint> => {
  const read = readCompactUint(position);
  if (typeof read === 'string') {
    return read;
  }
  const readLength = read.position.index - position.index;
  const canonicalEncoding = bigIntToCompactUint(read.result);
  if (readLength !== canonicalEncoding.length) {
    return formatError(
      CompactUintError.nonMinimal,
      `Value: ${read.result.toString()}, encoded length: ${readLength}, canonical length: ${
        canonicalEncoding.length
      }`,
    );
  }
  return read;
};

export enum CompactUintPrefixedBinError {
  invalidCompactUint = 'Error reading CompactUint-prefixed bin: invalid CompactUint.',
  insufficientBytes = 'Error reading CompactUint-prefixed bin: insufficient bytes.',
}

/**
 * Read a bin (`Uint8Array`) that is prefixed by a minimally-encoded
 * `CompactUint` starting at the provided {@link ReadPosition}, returning either
 * an error message (as a string) or an object containing the `Uint8Array` and
 * the next {@link ReadPosition}. (In the transaction format,
 * `CompactUint`-prefixes are used to indicate the length of unlocking bytecode,
 * locking bytecode, and non-fungible token commitments.)
 *
 * @param position - the {@link ReadPosition} at which to start reading the
 * `CompactUint`-prefixed bin (`Uint8Array`)
 */
export const readCompactUintPrefixedBin = (
  position: ReadPosition,
): MaybeReadResult<Uint8Array> => {
  const read = readCompactUintMinimal(position);
  if (typeof read === 'string') {
    return formatError(CompactUintPrefixedBinError.invalidCompactUint, read);
  }
  const { result, position: p2 } = read;
  const length = Number(result);
  const nextPosition = { bin: position.bin, index: p2.index + length };
  const contents = position.bin.slice(p2.index, nextPosition.index);
  if (contents.length !== length) {
    return formatError(
      CompactUintPrefixedBinError.insufficientBytes,
      `Required bytes: ${length}, remaining bytes: ${contents.length}`,
    );
  }
  return { position: nextPosition, result: contents };
};

/**
 * Reduce an array of `Uint8Array`s into a single `Uint8Array`.
 * @param array - the array of `Uint8Array`s to flatten
 */
export const flattenBinArray = (array: readonly Uint8Array[]) => {
  const totalLength = array.reduce((total, bin) => total + bin.length, 0);
  const flattened = new Uint8Array(totalLength);
  /// eslint-disable-next-line functional/no-expression-statement
  array.reduce((index, bin) => {
    /// eslint-disable-next-line functional/no-expression-statement
    flattened.set(bin, index);
    return index + bin.length;
  }, 0);
  return flattened;
};

// export function byteArrayToHexStr(uint8 : Uint8Array) {
//   return Array.from(uint8)
//   .map((i) => i.toString(16).padStart(2, '0'))
//   .join('');
// }

// --------------------------------------------------------------------------------------
// --------------------------------------------------------------------------------------
// --------------------------------------------------------------------------------------
// --------------------------------------------------------------------------------------
// --------------------------------------------------------------------------------------

// --------------------------------------------------------------------------------------
// Main code
// --------------------------------------------------------------------------------------

export interface Token<ByteStringRepresentation = Uint8Array> {
  /**
   * The number of fungible tokens (of `category`) held .
   *
   * Because `Number.MAX_SAFE_INTEGER` (`9007199254740991`) is less than the
   * maximum token amount (`9223372036854775807`), this value is encoded as
   * a `bigint`.
   */
  amount: bigint;
  /**
   * The 32-byte ID of the token category to which the token(s)
   * belong in big-endian byte order. This is the byte order typically seen in
   * block explorers and user interfaces (as opposed to little-endian byte
   * order, which is used in standard P2P network messages).
   */
  category: ByteStringRepresentation;
  /**
   * If present, the non-fungible token (NFT) held.
   */
  nft?: {
    /**
     * The {@link NonFungibleTokenCapability} of this non-fungible token.
     */
    capability: `${NonFungibleTokenCapability}`;

    /**
     * The commitment contents included in the non-fungible token (of
     * `category`) held.
     */
    commitment: ByteStringRepresentation;
  };
}

export enum NonFungibleTokenCapability {
  none = 'none', // No capability, i.e. the token is an **immutable token**.
  mutable = 'mutable', // The mutable capability (`0x01`), i.e. the token is a **mutable token**.
  minting = 'minting', // The minting capability (`0x02`), i.e. the token is a **minting token**.
}

export const enum CashTokens {
  PREFIX_TOKEN = 0xef,

  // HAS_AMOUNT = 0b00010000,
  // HAS_NFT = 0b00100000,
  // HAS_COMMITMENT_LENGTH = 0b01000000,
  // RESERVED_BIT = 0b10000000,

  // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
  categoryLength = 32,
  tokenBitfieldIndex = 33,
  minimumPrefixLength = 34,
  tokenFormatMask = 0xf0,
  nftCapabilityMask = 0x0f,
  maximumCapability = 2,
  // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
  useBinaryOutput = 2,
}

export const enum Structure {
  HAS_AMOUNT = 0b00010000,
  HAS_NFT = 0b00100000,
  HAS_COMMITMENT_LENGTH = 0b01000000,
  RESERVED_BIT = 0b10000000,
}

export const maximumTokenAmount = 9223372036854775807n;

export const nftCapabilityNumberToLabel = [
  NonFungibleTokenCapability.none,
  NonFungibleTokenCapability.mutable,
  NonFungibleTokenCapability.minting,
] as const;

export const nftCapabilityLabelToNumber: {
  [key in NonFungibleTokenCapability]: number;
} = {
  [NonFungibleTokenCapability.none]: 0,
  [NonFungibleTokenCapability.mutable]: 1,
  [NonFungibleTokenCapability.minting]: 2,
} as const;

export enum CashTokenDecodingError {
  invalidPrefix = 'Error reading token prefix.',
  insufficientLength = 'Invalid token prefix: insufficient length.',
  reservedBit = 'Invalid token prefix: reserved bit is set.',
  invalidCapability = 'Invalid token prefix: capability must be none (0), mutable (1), or minting (2).',
  commitmentWithoutNft = 'Invalid token prefix: commitment requires an NFT.',
  capabilityWithoutNft = 'Invalid token prefix: capability requires an NFT.',
  commitmentLengthZero = 'Invalid token prefix: if encoded, commitment length must be greater than 0.',
  invalidCommitment = 'Invalid token prefix: invalid non-fungible token commitment.',
  invalidAmountEncoding = 'Invalid token prefix: invalid fungible token amount encoding.',
  zeroAmount = 'Invalid token prefix: if encoded, fungible token amount must be greater than 0.',
  excessiveAmount = 'Invalid token prefix: exceeds maximum fungible token amount of 9223372036854775807.',
  noTokens = 'Invalid token prefix: must encode at least one token.',
}

/**
 * Read a token amount from the provided {@link ReadPosition}, returning either
 * an error message (as a string) or an object containing the value and the next
 * {@link ReadPosition}.
 *
 * @param position - the {@link ReadPosition} at which to start reading the
 * token amount.
 */
export const readTokenAmount = (
  position: ReadPosition,
): MaybeReadResult<bigint> => {
  const amountRead = readCompactUintMinimal(position);
  if (typeof amountRead === 'string') {
    return formatError(
      CashTokenDecodingError.invalidAmountEncoding,
      amountRead,
    );
  }
  if (amountRead.result > maximumTokenAmount) {
    return formatError(
      CashTokenDecodingError.excessiveAmount,
      `Encoded amount: ${amountRead.result}`,
    );
  }
  if (amountRead.result === 0n) {
    return formatError(CashTokenDecodingError.zeroAmount);
  }
  return amountRead;
};

/**
 * Attempt to read a transaction token prefix from the provided
 * {@link ReadPosition}, returning either an error message (as a string) or an
 * object containing the (optional) token information and the
 * next {@link ReadPosition}.
 *
 * Rather than using this function directly, most applications
 * should use {@link readLockingBytecodeWithPrefix}.
 *
 * @param position - the {@link ReadPosition} at which to start reading the
 * token prefix
 */
// eslint-disable-next-line complexity
export const readTokenPrefix = (
  // eslint-disable-line @typescript-eslint/no-unused-vars
  position: ReadPosition,
): MaybeReadResult<{ token?: NonNullable<Token> }> => {
  const { bin, index } = position;
  if (bin[index] !== CashTokens.PREFIX_TOKEN) {
    return { position, result: {} };
  }
  if (bin.length < index + CashTokens.minimumPrefixLength) {
    return formatError(
      CashTokenDecodingError.insufficientLength,
      `The minimum possible length is ${
        CashTokens.minimumPrefixLength
      }. Missing bytes: ${
        CashTokens.minimumPrefixLength - (bin.length - index)
      }`,
    );
  }
  const category = bin
    .slice(index + 1, index + CashTokens.tokenBitfieldIndex)
    .reverse();
  const tokenBitfield = bin[index + CashTokens.tokenBitfieldIndex]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
  /* eslint-disable no-bitwise */
  const prefixStructure = tokenBitfield & CashTokens.tokenFormatMask;
  if ((prefixStructure & Structure.RESERVED_BIT) !== 0) {
    return formatError(
      CashTokenDecodingError.reservedBit,
      `Bitfield: 0b${tokenBitfield.toString(CashTokens.useBinaryOutput)}`,
    );
  }
  const nftCapabilityInt = tokenBitfield & CashTokens.nftCapabilityMask;
  if (nftCapabilityInt > CashTokens.maximumCapability) {
    return formatError(
      CashTokenDecodingError.invalidCapability,
      `Capability value: ${nftCapabilityInt}`,
    );
  }
  const capability = nftCapabilityNumberToLabel[nftCapabilityInt]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
  const hasNft = (prefixStructure & Structure.HAS_NFT) !== 0;
  const hasCommitmentLength =
    (prefixStructure & Structure.HAS_COMMITMENT_LENGTH) !== 0;
  if (hasCommitmentLength && !hasNft) {
    return formatError(
      CashTokenDecodingError.commitmentWithoutNft,
      `Bitfield: 0b${tokenBitfield.toString(CashTokens.useBinaryOutput)}`,
    );
  }
  const hasAmount = (prefixStructure & Structure.HAS_AMOUNT) !== 0;
  /* eslint-enable no-bitwise */
  const nextPosition = {
    bin,
    index: index + CashTokens.tokenBitfieldIndex + 1,
  };
  if (hasNft) {
    const commitmentRead = hasCommitmentLength
      ? readCompactUintPrefixedBin(nextPosition)
      : { position: nextPosition, result: Uint8Array.of() };
    if (typeof commitmentRead === 'string') {
      return formatError(
        CashTokenDecodingError.invalidCommitment,
        commitmentRead,
      );
    }
    if (hasCommitmentLength && commitmentRead.result.length === 0) {
      return formatError(CashTokenDecodingError.commitmentLengthZero);
    }
    const amountRead = hasAmount
      ? readTokenAmount(commitmentRead.position)
      : { position: commitmentRead.position, result: 0n };
    if (typeof amountRead === 'string') {
      return amountRead;
    }
    return {
      position: amountRead.position,
      result: {
        token: {
          amount: amountRead.result,
          category,
          nft: { capability, commitment: commitmentRead.result },
        },
      },
    };
  }
  if (capability !== NonFungibleTokenCapability.none) {
    return formatError(
      CashTokenDecodingError.capabilityWithoutNft,
      `Bitfield: 0b${tokenBitfield.toString(CashTokens.useBinaryOutput)}`,
    );
  }
  if (!hasAmount) {
    return formatError(
      CashTokenDecodingError.noTokens,
      `Bitfield: 0b${tokenBitfield.toString(CashTokens.useBinaryOutput)}`,
    );
  }
  const amountRead = readTokenAmount(nextPosition);
  if (typeof amountRead === 'string') {
    return amountRead;
  }
  return {
    position: amountRead.position,
    result: { token: { amount: amountRead.result, category } },
  };
};

/**
 * Given {@link token} data, encode a token prefix.
 *
 * This function does not fail, but returns an empty Uint8Array if the token
 * data does not encode any tokens (even if `token.category` is set).
 *
 * @param token - the token data to encode
 */
// eslint-disable-next-line complexity
export const encodeTokenPrefix = (token: Token) => {
  // eslint-disable-line @typescript-eslint/no-unused-vars
  if (token === undefined || (token.nft === undefined && token.amount < 1n)) {
    return Uint8Array.of();
  }
  const hasNft = token.nft === undefined ? 0 : Structure.HAS_NFT;
  const capabilityInt =
    token.nft === undefined
      ? 0
      : nftCapabilityLabelToNumber[token.nft.capability];
  const hasCommitmentLength =
    token.nft !== undefined && token.nft.commitment.length > 0
      ? Structure.HAS_COMMITMENT_LENGTH
      : 0;
  const hasAmount = token.amount > 0n ? Structure.HAS_AMOUNT : 0;
  const tokenBitfield =
    // eslint-disable-next-line no-bitwise
    hasNft | hasCommitmentLength | hasAmount | capabilityInt;
  return flattenBinArray([
    Uint8Array.of(CashTokens.PREFIX_TOKEN),
    token.category.slice().reverse(),
    Uint8Array.of(tokenBitfield),
    ...(hasCommitmentLength === 0
      ? []
      : [
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          bigIntToCompactUint(BigInt(token.nft!.commitment.length)),
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          token.nft!.commitment,
        ]),
    ...(hasAmount === 0 ? [] : [bigIntToCompactUint(token.amount)]),
  ]);
};

// write unit tests for encodeTokenPrefix function
