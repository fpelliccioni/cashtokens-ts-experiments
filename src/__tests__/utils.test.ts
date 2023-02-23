import {
  Token,
  NonFungibleTokenCapability,
  CashTokens,
  CashTokenDecodingError,
  readTokenPrefix,
  ReadPosition,
  bigIntToCompactUint,
  nftCapabilityLabelToNumber,
  Structure,
} from '../utils';

describe('Token', () => {
  it('should have correct properties', () => {
    const token: Token = {
      amount: 1n,
      category: new Uint8Array(32),
    };
    expect(token).toHaveProperty('amount');
    expect(token).toHaveProperty('category');
    expect(token).not.toHaveProperty('nft');
  });

  it('should have the required properties', () => {
    const token: Token = {
      amount: 0n,
      category: new Uint8Array(32),
      nft: {
        capability: NonFungibleTokenCapability.mutable,
        commitment: new Uint8Array(32),
      },
    };

    expect(token.amount).toEqual(0n);
    expect(token.category).toBeInstanceOf(Uint8Array);
    expect(token.category.length).toEqual(32);
    expect(token.nft).toBeTruthy();
    expect(token.nft!.capability).toEqual(NonFungibleTokenCapability.mutable); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    expect(token.nft!.commitment).toBeInstanceOf(Uint8Array); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    expect(token.nft!.commitment.length).toEqual(32); // eslint-disable-line @typescript-eslint/no-non-null-assertion
  });

  it('should have optional NFT property', () => {
    const token: Token = {
      amount: 1n,
      category: new Uint8Array(32),
      nft: {
        capability: NonFungibleTokenCapability.mutable,
        commitment: new Uint8Array(32),
      },
    };
    expect(token).toHaveProperty('nft');
  });
});

describe('readTokenPrefix', () => {
  it('should read token prefix with no NFT', () => {
    const buffer = new Uint8Array([
      Structure.HAS_AMOUNT,
      ...new Uint8Array(32),
      ...bigIntToCompactUint(1n),
    ]);

    const position: ReadPosition = {
      bin: buffer,
      index: 0,
    };

    const maybeToken = readTokenPrefix(position);
    expect(typeof maybeToken).not.toBe('string');
    if (typeof maybeToken === 'string') return;

    expect(maybeToken.result.token!).toMatchObject({
      // eslint-disable-line @typescript-eslint/no-non-null-assertion
      amount: 1n,
      category: new Uint8Array(32),
    });
  });

  it('should read token prefix with NFT', () => {
    const buffer = new Uint8Array([
      Structure.HAS_AMOUNT |
        Structure.HAS_NFT |
        Structure.HAS_COMMITMENT_LENGTH,
      ...new Uint8Array(32),
      nftCapabilityLabelToNumber[NonFungibleTokenCapability.mutable],
      ...bigIntToCompactUint(32n),
      ...new Uint8Array(32),
    ]);

    const position: ReadPosition = {
      bin: buffer,
      index: 0,
    };

    const maybeToken = readTokenPrefix(position);
    expect(typeof maybeToken).not.toBe('string');
    if (typeof maybeToken === 'string') return;

    // expect(result.result).toMatchObject({
    //   amount: 0n,
    //   category: new Uint8Array(32),
    //   nft: {
    //     capability: NonFungibleTokenCapability.mutable,
    //     commitment: new Uint8Array(32),
    //   },
    // });
  });

  it('should return error if prefix has reserved bit set', () => {
    const buffer = new Uint8Array([
      Structure.RESERVED_BIT,
      ...new Uint8Array(32),
      ...bigIntToCompactUint(1n),
    ]);

    const position: ReadPosition = {
      bin: buffer,
      index: 0,
    };
    const maybeToken = readTokenPrefix(position);

    expect(typeof maybeToken).toBe('string');
    // if (typeof maybeToken !== 'string') return;
    expect(maybeToken).toEqual(CashTokenDecodingError.reservedBit);
  });

  // it("should return an error if prefix byte length is less than the minimum length", () => {

  //   const position : ReadPosition = {
  //     bin: new Uint8Array(0),
  //     index: 0
  //   };
  //   const maybeToken = readTokenPrefix(position);
  //   expect(typeof maybeToken).not.toBe('string');
  //   if (typeof maybeToken === 'string') return;

  //   expect(result.errorMessage).toEqual(CashTokenDecodingError.insufficientLength);
  // });

  // it("should return an error if the reserved bit is set", () => {
  //     const position : ReadPosition = {
  //       bin: new Uint8Array([0xf1]),
  //       index: 0
  //     };

  //     const maybeToken = readTokenPrefix(position);
  //     expect(typeof maybeToken).not.toBe('string');
  //     if (typeof maybeToken === 'string') return;

  //     expect(result.errorMessage).toEqual(CashTokenDecodingError.reservedBit);
  // });

  // it("should return an error if the token capability is invalid", () => {
  //     const position : ReadPosition = {
  //       bin: new Uint8Array([0xee]),
  //       index: 0
  //     };

  //     const maybeToken = readTokenPrefix(position);
  //     expect(typeof maybeToken).not.toBe('string');
  //     if (typeof maybeToken === 'string') return;

  //     expect(result.errorMessage).toEqual(CashTokenDecodingError.invalidCapability);
  // });

  // it("should return an error if commitment is encoded without NFT", () => {
  //     const position : ReadPosition = {
  //       bin: new Uint8Array([0xef, 0x40]),
  //       index: 0
  //     };
  //     const maybeToken = readTokenPrefix(position);
  //     expect(typeof maybeToken).not.toBe('string');
  //     if (typeof maybeToken === 'string') return;

  //     expect(result.errorMessage).toEqual(CashTokenDecodingError.commitmentWithoutNft);
  // });

  // it("should return an error if capability is encoded without NFT", () => {
  //     const position : ReadPosition = {
  //       bin: new Uint8Array([0xef, 0x10]),
  //       index: 0
  //     };
  //     const maybeToken = readTokenPrefix(position);
  //     expect(typeof maybeToken).not.toBe('string');
  //     if (typeof maybeToken === 'string') return;

  //     expect(result.errorMessage).toEqual(CashTokenDecodingError.capabilityWithoutNft);
  // });

  // it("should return an error if commitment length is 0", () => {
  //     const position : ReadPosition = {
  //       bin: new Uint8Array([0xef, 0x20, 0x00]),
  //       index: 0
  //     };
  //     const maybeToken = readTokenPrefix(position);
  //     expect(typeof maybeToken).not.toBe('string');
  //     if (typeof maybeToken === 'string') return;

  //     expect(result.errorMessage).toEqual(CashTokenDecodingError.commitmentLengthZero);
  // });

  // it("should return an error if commitment is invalid", () => {
  //     const position : ReadPosition = {
  //       bin: new Uint8Array([0xef, 0x20, 0x01, 0x01]),
  //       index: 0
  //     };
  //     const maybeToken = readTokenPrefix(position);
  //     expect(typeof maybeToken).not.toBe('string');
  //     if (typeof maybeToken === 'string') return;

  //     expect(result.errorMessage).toEqual(CashTokenDecodingError.invalidCommitment);
  // });

  // it("should return an error if amount encoding is invalid", () => {
  //     const position : ReadPosition = {
  //       bin: new Uint8Array([0xef, 0x10, 0x80]),
  //       index: 0
  //     };
  //     const maybeToken = readTokenPrefix(position);
  //     expect(typeof maybeToken).not.toBe('string');
  //     if (typeof maybeToken === 'string') return;

  //     expect(result.errorMessage).toEqual(CashTokenDecodingError.invalidAmountEncoding);
  // });

  // // it("should return an error if amount is 0", () => {
  // //   const position = new ReadPosition(new Uint8Array([0xef, 0x10
});

// describe('encodeTokenPrefix', () => {
//     it('should encode token prefix with no NFT', () => {
//     const token: Token = {
//       amount: 1n,
//       category: new Uint8Array(32),
//     };
//     const result = encodeTokenPrefix(token);
//     expect(result).toMatchObject([
//       CashTokens.PREFIX_TOKEN | Structure.HAS_AMOUNT,
//       ...new Uint8Array(32),
//       ...bigIntToCompactUint(1n),
//     ]);
//   });

//   it('should encode token prefix with NFT', () => {
//     const token: Token = {
//       amount: 0n,
//       category: new Uint8Array(32),
//       nft: {
//         capability: NonFungibleTokenCapability.mutable,
//         commitment: new Uint8Array(32),
//       },
//     };
//     const result = encodeTokenPrefix(token);
//     expect(result).toMatchObject([
//       CashTokens.PREFIX_TOKEN |
//         Structure.HAS_NFT |
//         Structure.HAS_COMMITMENT_LENGTH,
//       ...new Uint8Array(32),
