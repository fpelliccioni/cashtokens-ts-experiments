# CHIP-2022-02-CashTokens: Token Primitives for Bitcoin Cash

## Summary

This proposal enables two new primitives on Bitcoin Cash: **fungible tokens**
and **non-fungible tokens**.

### Terms

A **token** is an asset – distinct from the Bitcoin Cash currency – that can be
created and transferred on the Bitcoin Cash network.

**Non-Fungible tokens (NFTs)** are a token type in which individual units cannot
be merged or divided – each NFT contains a **commitment**, a short byte string
attested to by the issuer of the NFT.

**Fungible tokens** are a token type in which individual units are
undifferentiated – groups of fungible tokens can be freely divided and merged
without tracking the identity of individual tokens (much like the Bitcoin Cash
currency).

## Technical Summary

1. A token **category** can include both non-fungible and fungible tokens, and
   every category is represented by a 32-byte category identifier – the
   transaction ID of the outpoint spent to create the category.
   1. All fungible tokens for a category must be created when the token category
      is created, ensuring the total supply within a category remains below the
      maximum VM number.
   2. Non-fungible tokens may be created either at category creation or in later
      transactions that spend tokens with `minting` or `mutable` capabilities
      for that category.
2. Transaction outputs are extended to support four new `token` fields; every
   output can include one **non-fungible token** and any amount of **fungible
   tokens** from a single token category.

### Transaction Output Data Model

This proposal extends the data model of transaction outputs to add four new
`token` fields: token `category`, non-fungible token `capability`, non-fungible
token `commitment`, and fungible token `amount`.

| Token Fields | Description                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Category     | The 32-byte ID of the token category to which the token(s) in this output belong. This field is omitted if no tokens are present.                              |
| Capability   | The capability of the NFT held in this output: `none`, `mutable`, or `minting`. This field is omitted if no NFT is present.                                    |
| Commitment   | The commitment contents of the NFT held in this output (`0` to `40` bytes). This field is omitted if no NFT is present.                                        |
| Amount       | The number of fungible tokens held in this output (an integer between `1` and `9223372036854775807`). This field is omitted if no fungible tokens are present. |

## Technical Specification

Token primitives are defined, token encoding is specified. Transaction
validation and transaction signing serialization is modified to support tokens,
`SIGHASH_UTXOS` is specified.

### Token Categories

Every token belongs to a **token category** specified via an immutable, 32-byte
**Token Category ID** assigned in the category's **genesis transaction** – the
transaction in which the token category is initially created.

Every token category ID is a transaction ID: the ID must be selected from the
inputs of its genesis transaction, and only **token genesis inputs** – inputs
which spend output `0` of their parent transaction – are eligible (i.e. outpoint
transaction hashes of inputs with an outpoint index of `0`). As such,
implementations can locate the genesis transaction of any category by
identifying the transaction that spent the `0`th output of the transaction
referenced by the category ID. (See
[Use of Transaction IDs as Token Category IDs](rationale.md#use-of-transaction-ids-as-token-category-ids).)

Note that because every transaction has at least one output, every transaction
ID can later become a token category ID.

### Token Types

Two token types are introduced: **fungible tokens** and **non-fungible tokens**.
Fungible tokens have only one property: a 32-byte `category`. Non-fungible
tokens have three properties: a 32-byte `category`, a `0` to `40` byte
`commitment`, and a `capability` of `minting`, `mutable`, or `none`.

### Token Behavior

Token behavior is enforced by the
[**token validation algorithm**](#token-validation-algorithm). This algorithm
has the following effects:

#### Universal Token Behavior

1.  A single transaction can create multiple new token categories, and each
    category can contain both fungible and non-fungible tokens.
2.  Tokens can be implicitly destroyed by omission from a transaction's outputs.
3.  Each transaction output can contain zero or one non-fungible token and any
    `amount` of fungible tokens, but all tokens in an output must share the same
    token category.

#### Non-Fungible Token Behavior

1.  A transaction output can contain zero or one **non-fungible token**.
2.  Non-fungible tokens (NFTs) of a particular category are created either in
    the category's genesis transaction or by later transactions that spend
    `minting` or `mutable` tokens of the same category.
3.  It is possible for multiple NFTs of the same category to carry the same
    commitment. (Though uniqueness can be enforced by covenants.)
4.  **Minting tokens** (NFTs with the `minting` capability) allow the spending
    transaction to create any number of new NFTs of the same category, each with
    any commitment and (optionally) the `minting` or `mutable` capability.
5.  Each **Mutable token** (NFTs with the `mutable` capability) allows the
    spending transaction to create one NFT of the same category, with any
    commitment and (optionally) the `mutable` capability.
6.  **Immutable tokens** (NFTs without a capability) cannot have their
    commitment modified when spent.

#### Fungible Token Behavior

1.  A transaction output can contain any `amount` of fungible tokens from a
    single category.
2.  All fungible tokens of a category are created in that category's genesis
    transaction; their combined `amount` may not exceed `9223372036854775807`.
3.  A transaction can spend fungible tokens from any number of UTXOs to any
    number of outputs, so long as the sum of output `amount`s do not exceed the
    sum of input `amount`s (for each token category).

Note that fungible tokens behave independently from non-fungible tokens:
non-fungible tokens are never counted in the `amount`, and the existence of
`minting` or `mutable` NFTs in a transaction's inputs do not allow for new
fungible tokens to be created.

### Token Encoding

Tokens are encoded in outputs using a **token prefix**, a data structure that
can encode a token category, zero or one non-fungible token (NFT), and an amount
of fungible tokens (FTs).

For backwards-compatibility with existing transaction decoding implementations,
a transaction output's token prefix (if present) is encoded before index `0` of
its locking bytecode, and the `CompactSize` length preceding the two fields is
increased to cover both fields (such that the length could be renamed
`token_prefix_and_locking_bytecode_length`). The token prefix is not part of the
locking bytecode and must not be included in bytecode evaluation. To illustrate,
after deployment, the serialized output format becomes:

```
<satoshi_value> <token_prefix_and_locking_bytecode_length> [PREFIX_TOKEN <token_data>] <locking_bytecode>
```

#### Token Prefix

`PREFIX_TOKEN` is defined at codepoint `0xef` (`239`) and indicates the presence
of a token prefix:

```
PREFIX_TOKEN <category_id> <token_bitfield> [nft_commitment_length nft_commitment] [ft_amount]
```

1. `<category_id>` – After the `PREFIX_TOKEN` byte, a 32-byte **Token Category
   ID** is required, encoded in `OP_HASH256` byte order<sup>1</sup>.
2. `<token_bitfield>` - A bitfield encoding two 4-bit fields is required:
   1. `prefix_structure` (`token_bitfield & 0xf0`) - 4 bitflags, defined at the
      higher half of the bitfield, indicating the structure of the token prefix:
      1. `0x80` (`0b10000000`) - `RESERVED_BIT`, must be unset.
      2. `0x40` (`0b01000000`) - `HAS_COMMITMENT_LENGTH`, the prefix encodes a
         commitment length and commitment.
      3. `0x20` (`0b00100000`) - `HAS_NFT`, the prefix encodes a non-fungible
         token.
      4. `0x10` (`0b00010000`) - `HAS_AMOUNT`, the prefix encodes an amount of
         fungible tokens.
   2. `nft_capability` (`token_bitfield & 0x0f`) – A 4-bit value, defined at the
      lower half of the bitfield, indicating the non-fungible token capability,
      if present.
      1. If not `HAS_NFT`: must be `0x00`.
      2. If `HAS_NFT`:
         1. `0x00` – No capability – the encoded non-fungible token is an
            **immutable token**.
         2. `0x01` – The **`mutable` capability** – the encoded non-fungible
            token is a **mutable token**.
         3. `0x02` – The **`minting` capability** – the encoded non-fungible
            token is a **minting token**.
         4. Values greater than `0x02` are reserved and must not be used.
3. If `HAS_COMMITMENT_LENGTH`:
   1. `commitment_length` – A **commitment length** is required
      (minimally-encoded in `CompactSize` format<sup>2</sup>) with a minimum
      value of `1` (`0x01`).
   2. `commitment` – The non-fungible token's **commitment** byte string of
      `commitment_length` is required.
4. If `HAS_AMOUNT`:
   1. `ft_amount` – An amount of **fungible tokens** is required
      (minimally-encoded in `CompactSize` format<sup>2</sup>) with a minimum
      value of `1` (`0x01`) and a maximum value equal to the maximum VM number,
      `9223372036854775807` (`0xffffffffffffff7f`).

<summary>Notes</summary>

1. This is the byte order produced/required by all BCH VM operations which
   employ SHA-256 (including `OP_SHA256` and `OP_HASH256`), the byte order used
   for outpoint transaction hashes in the P2P transaction format, and the byte
   order produced by most SHA-256 libraries. For reference, the genesis block
   header in this byte order is little-endian –
   `6fe28c0ab6f1b372c1a6a246ae63f74f931e8365e15a089c68d6190000000000` – and can
   be produced by this script:
   `<0x0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c> OP_HASH256`.
   (Note, this is the opposite byte order as is commonly used in user interfaces
   like block explorers.)
2. The **`CompactSize` Format** is a variable-length, little-endian, positive
   integer format used to indicate the length of the following byte array in
   Bitcoin Cash P2P protocol message formats (present since the protocol's
   publication in 2008). The format historically allowed some values to be
   encoded in multiple ways; token prefixes must always use
   minimally-encoded/canonically-encoded `CompactSize`s, e.g. the value `1` must
   be encoded as `0x01` rather than `0xfd0100`, `0xfe0100000`, or
   `0xff010000000000000`.

#### Token Prefix Validation

1. By consensus, `commitment_length` is limited to `40` (`0x28`), but future
   upgrades may increase this limit. Implementers are advised to ensure that
   values between `253` (`0xfdfd00`) and `65535` (`0xfdffff`) can be parsed.
   (See
   [Non-Fungible Token Commitment Length](rationale.md#non-fungible-token-commitment-length).)
2. A token prefix encoding no tokens (both `HAS_NFT` and `HAS_AMOUNT` are unset)
   is invalid.
3. A token prefix encoding `HAS_COMMITMENT_LENGTH` without `HAS_NFT` is invalid.
4. A token prefix where `HAS_NFT` is unset must encode `nft_capability` of
   `0x00`.

#### Token Prefix Standardness

Implementations must recognize otherwise-standard outputs with token prefixes as
**standard**.

##### Reserved Token Prefix Encodings

These encodings are valid but disabled due to excessive `commitment_length`s.
Transactions attempting to create outputs with these token prefixes are
currently rejected by consensus, but future upgrades may increase the maximum
valid `commitment_length`.

| Description                                        | Encoded (Hex)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 41-byte immutable NFT; 65536 fungible              | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb7029ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccfe00000100`                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 41-byte, mutable NFT; 252 fungible                 | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb7129ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccfc`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 41-byte, minting NFT; 9223372036854775807 fungible | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb7229ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccffffffffffffffff7f`                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 253-byte, immutable NFT; 0 fungible                | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb60fdfd00cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc` |

#### Invalid Token Prefix Encodings

| Reason                                                                                                 | Encoded (Hex)                                                                              |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Token prefix must encode at least one token                                                            | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb00`                     |
| Token prefix must encode at least one token (0 fungible)                                               | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1000`                   |
| Token prefix requires a token category ID                                                              | `ef`                                                                                       |
| Token category IDs must be 32 bytes                                                                    | `efbbbbbbbb1001`                                                                           |
| Missing token bitfield                                                                                 | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`                       |
| Token bitfield sets reserved bit                                                                       | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb9001`                   |
| Unknown capability (0-byte NFT, capability 3)                                                          | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb23`                     |
| Has commitment length without NFT (1 fungible)                                                         | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb5001`                   |
| Prefix encodes a capability without an NFT                                                             | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1101`                   |
| Commitment length must be specified (immutable token)                                                  | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb60`                     |
| Commitment length must be specified (mutable token)                                                    | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb61`                     |
| Commitment length must be specified (minting token)                                                    | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb62`                     |
| Commitment length must be minimally-encoded                                                            | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb60fd0100cc`             |
| If specified, commitment length must be greater than 0                                                 | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb6000`                   |
| Not enough bytes remaining in locking bytecode to satisfy commitment length (0/1 bytes)                | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb6001`                   |
| Not enough bytes remaining in locking bytecode to satisfy commitment length (mutable token, 0/1 bytes) | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb6101`                   |
| Not enough bytes remaining in locking bytecode to satisfy commitment length (mutable token, 1/2 bytes) | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb6102cc`                 |
| Not enough bytes remaining in locking bytecode to satisfy commitment length (minting token, 1/2 bytes) | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb6202cc`                 |
| Not enough bytes remaining in locking bytecode to satisfy token amount (no NFT, 1-byte amount)         | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb10`                     |
| Not enough bytes remaining in locking bytecode to satisfy token amount (no NFT, 2-byte amount)         | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb10fd00`                 |
| Not enough bytes remaining in locking bytecode to satisfy token amount (no NFT, 4-byte amount)         | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb10fe000000`             |
| Not enough bytes remaining in locking bytecode to satisfy token amount (no NFT, 8-byte amount)         | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb10ff00000000000000`     |
| Not enough bytes remaining in locking bytecode to satisfy token amount (immutable NFT, 1-byte amount)  | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb7001cc`                 |
| Not enough bytes remaining in locking bytecode to satisfy token amount (immutable NFT, 2-byte amount)  | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb7001ccfd00`             |
| Not enough bytes remaining in locking bytecode to satisfy token amount (immutable NFT, 4-byte amount)  | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb7001ccfe000000`         |
| Not enough bytes remaining in locking bytecode to satisfy token amount (immutable NFT, 8-byte amount)  | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb7001ccff00000000000000` |
| Token amount must be specified                                                                         | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb30`                     |
| If specified, token amount must be greater than 0 (no NFT)                                             | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1000`                   |
| If specified, token amount must be greater than 0 (0-byte NFT)                                         | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb3000`                   |
| Token amount must be minimally-encoded                                                                 | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb10fd0100`               |
| Token amount (9223372036854775808) may not exceed 9223372036854775807                                  | `efbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb30ff0000000000000080`   |

### Token Encoding Activation

**Pre-activation token-forgery outputs (PATFOs)** are transaction outputs mined
in blocks prior to activation of this specification where locking bytecode index
`0` is set to the `PREFIX_TOKEN` codepoint.

Prior to activation, PATFOs remain **nonstandard** but do not invalidate the
transaction by consensus. Because they can still be mined in valid blocks,
PATFOs can be used to prepare outputs that, after activation of this
specification, could encode tokens for which
[Token-Aware Transaction Validation](#token-aware-transaction-validation) was
not enforced (producing token categories that do not map to a confirmed
transaction hash or have a fungible token supply exceeding the maximum amount).

Note, even properly-encoded token outputs included in transactions mined prior
to activation are considered PATFOs, regardless of whether or not the
transaction would pass token-aware transaction validation after activation. Due
to the possibility of a chain re-organization impacting the precise activation
time, token issuers are advised to wait until activation is confirmed to a depth
of at least 11 blocks before broadcasting critical transactions involving
tokens.

PATFOs are provably unspendable<sup>1</sup>; all software implementing this
specification should immediately mark PATFOs as unspendable and/or remove them
from their local view of the UTXO set (e.g. on startup and upon receipt).

**By consensus, PATFOs mined in blocks prior to the activation of
[Token-Aware Transaction Validation](#token-aware-transaction-validation) must
remain unspendable after activation**. (Please note: the presence of PATFOs does
not render a transaction invalid; until activation, valid blocks may contain
PATFOs.)

After activation, any transaction creating an invalid token prefix<sup>2</sup>
is itself invalid, and all transactions must pass
[Token-Aware Transaction Validation](#token-aware-transaction-validation).

<summary>Notes</summary>

1. For pre-activation token-forgery outputs (PATFOs), this has been the case for
   even longer than `OP_RETURN` outputs: PATFOs have been provably unspendable
   since the Bitcoin Cash protocol's publication in 2008. As such, they can be
   safely pruned without activation and at no risk of network consensus
   failures.
2. That is, any transaction output where locking bytecode index `0` is set to
   the `PREFIX_TOKEN` codepoint, but a valid token prefix cannot be parsed.

### Token-Aware Transaction Validation

For any transaction to be valid, the
[**token validation algorithm**](#token-validation-algorithm) must succeed.

#### Token Validation Algorithm

Given the following **definitions**:

1. Reducing the set of UTXOs spent by the transaction:
   1. A key-value map of **`Available_Sums_By_Category`** (mapping category IDs
      to positive, 64-bit integers) is created by summing the input `amount` of
      each token category.
   2. A key-value map of **`Available_Mutable_Tokens_By_Category`** (mapping
      category IDs to positive integers) is created by summing the count of
      input mutable tokens for each category.
   3. A list of **`Genesis_Categories`** is created including the outpoint
      transaction hash of each input with an outpoint index of `0` (i.e. the
      spent UTXO was the 0th output in its transaction).
   4. A de-duplicated list of **`Input_Minting_Categories`** is created
      including the category ID of each input minting token.
   5. A list of **`Available_Minting_Categories`** is the combination of
      `Genesis_Categories` and `Input_Minting_Categories`.
   6. A list of all **`Available_Immutable_Tokens`** (including duplicates) is
      created including each NFT which **does not** have a `minting` or
      `mutable` capability.
2. Reducing the set of outputs created by the transaction:
   1. A key-value map of **`Output_Sums_By_Category`** (mapping category IDs to
      positive, 64-bit integers) is created by summing the output `amount` of
      each token category.
   2. A key-value map of **`Output_Mutable_Tokens_By_Category`** (mapping
      category IDs to positive integers) is created by summing the count of
      output mutable tokens for each category.
   3. A de-duplicated list of **`Output_Minting_Categories`** is created
      including the category ID of each output minting token.
   4. A list of all **`Output_Immutable_Tokens`** (including duplicates) is
      created including each NFT which **does not** have a `minting` or
      `mutable` capability.

Perform the following **validations**:

1. Each category in `Output_Minting_Categories` must exist in
   `Available_Minting_Categories`.
2. Each category in `Output_Sums_By_Category` must either:
   1. Have an equal or greater sum in `Available_Sums_By_Category`, or
   2. Exist in `Genesis_Categories` and have an output sum no greater than
      `9223372036854775807` (the maximum VM number).
3. For each category in `Output_Mutable_Tokens_By_Category`, if the token's
   category ID exists in `Available_Minting_Categories`, skip this (valid)
   category. Else:
   1. Deduct the sum in `Output_Mutable_Tokens_By_Category` from the sum
      available in `Available_Mutable_Tokens_By_Category`. If the value falls
      below `0`, **fail validation**.
4. For each token in `Output_Immutable_Tokens`, if the token's category ID
   exists in `Available_Minting_Categories`, skip this (valid) token. Else:
   1. If an equivalent token exists in `Available_Immutable_Tokens` (comparing
      both category ID and commitment), remove it and continue to the next
      token. Else:
      1. Deduct `1` from the sum available for the token's category in
         `Available_Mutable_Tokens_By_Category`. If no mutable tokens are
         available to downgrade, **fail validation**.

Note: because coinbase transactions have only one input with an outpoint index
of `4294967295`, coinbase transactions can never include a token prefix in any
output.

See [Implementations](#implementations) for examples of this algorithm in
multiple programming languages.

### Signing Serialization of Tokens

The
[signing serialization algorithm](https://github.com/bitcoincashorg/bitcoincash.org/blob/3e2e6da8c38dab7ba12149d327bc4b259aaad684/spec/replay-protected-sighash.md)
(A.K.A `SIGHASH` algorithm) is enhanced to support tokens: when evaluating a
UTXO that includes tokens, the full, [encoded token prefix](#token-encoding)
(including `PREFIX_TOKEN`) must be included immediately before the
`coveredBytecode` (A.K.A. `scriptCode`). Note: this behavior applies for all
signing serialization types in the evaluation; it does not require a signing
serialization type/flag.

### `SIGHASH_UTXOS`

A new signing serialization type, `SIGHASH_UTXOS`, is defined at `0x20`
(`32`/`0b100000`). When `SIGHASH_UTXOS` is enabled, `hashUtxos` is inserted in
the
[signing serialization algorithm](https://github.com/bitcoincashorg/bitcoincash.org/blob/3e2e6da8c38dab7ba12149d327bc4b259aaad684/spec/replay-protected-sighash.md)
immediately following `hashPrevouts`. `hashUtxos` is a 32-byte double SHA256 of
the serialization of all UTXOs spent by the transaction's inputs, concatenated
in input order, excluding output count. (Note: this serialization is equivalent
to the segment of a P2P transaction message beginning after `output count` and
ending before `locktime` if the UTXOs were serialized in order as the
transaction's outputs.)

The `SIGHASH_UTXOS` and `SIGHASH_ANYONECANPAY` types must not be used together;
if a signature in which both flags are enabled is encountered during VM
evaluation, an error is emitted (evaluation fails).

The `SIGHASH_UTXOS` type must be used with the `SIGHASH_FORKID` type; if a
signature is encountered during VM evaluation with the `SIGHASH_UTXOS` flag and
without the `SIGHASH_FORKID` flag, an error is emitted (evaluation fails).

### Fungible Token Supply Definitions

Several measurements of fungible token supply are standardized for wider
ecosystem compatibility. (See
[Specification of Token Supply Definitions](rationale.md#specification-of-token-supply-definitions).)

By design, [Genesis Supply](#genesis-supply),
[Reserved Supply](#reserved-supply), [Circulating Supply](#circulating-supply),
and [Total Supply](#total-supply) of any fungible token category will not exceed
`9223372036854775807` (the maximum VM number).

#### Genesis Supply

A token category's **genesis supply** is an **immutable, easily-computed,
maximum possible supply**, known since the token category's genesis transaction.
It overestimates total supply if any amount of tokens have been destroyed since
the genesis transaction.

The genesis supply of a fungible token category can be computed by parsing the
outputs of the category's genesis transaction and summing the `amount` of
fungible tokens matching the category's ID.

#### Total Supply

A token category's **total supply** is the sum – at a particular moment in time
– of **tokens which are either in circulation or may enter circulation in the
future**. A token category's total supply is always less than or equal to its
genesis supply.

The total supply of a fungible token category can be computed by retrieving all
UTXOs which contain token prefixes matching the category ID, removing
provably-destroyed outputs (spent to `OP_RETURN` outputs), and summing the
remaining `amount`s.

Software implementations should emphasize total supply in user interfaces for
token categories which do not meet the requirements for emphasizing
[circulating supply](#circulating-supply).

#### Reserved Supply

A token category's **reserved supply** is the sum – at a particular moment in
time – of tokens held in reserve by the issuing entity. **This is the portion of
the supply which the issuer represents as "not in circulation".**

The reserved supply of a fungible token category can be computed by retrieving
all UTXOs which contain token prefixes matching the category ID, removing
provably-destroyed outputs (spent to `OP_RETURN` outputs), and summing the
`amount`s held in prefixes which have either the `minting` or `mutable`
capability.

#### Circulating Supply

A token category's **circulating supply** is the sum – at a particular moment in
time – of tokens not held in reserve by the issuing entity. **This is the
portion of the supply which the issuer represents as "in circulation".**

The **circulating supply** of a fungible token category can be computed by
subtracting the [reserved supply](#reserved-supply) from the
[total supply](#total-supply).

Software implementations might choose to emphasize circulating supply (rather
than total supply) in user interfaces for token categories which:

- are issued by an entity trusted by the user, or
- are issued by a covenant (of a construction known to the verifier) for which
  token issuance is limited (via a strategy trusted by the user).
