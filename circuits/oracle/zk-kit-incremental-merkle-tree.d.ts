declare module "@zk-kit/incremental-merkle-tree" {
  export interface MerkleProof {
    root: bigint;
    leaf: bigint;
    pathIndices: number[];
    siblings: bigint[][];
  }

  export class IncrementalMerkleTree {
    constructor(
      hash: (values: bigint[]) => bigint,
      depth: number,
      zeroValue: bigint,
      arity?: number,
    );

    readonly root: bigint;
    readonly leaves: bigint[];
    insert(leaf: bigint): void;
    createProof(index: number): MerkleProof;
  }
}
