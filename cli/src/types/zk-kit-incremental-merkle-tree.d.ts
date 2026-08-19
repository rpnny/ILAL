declare module "@zk-kit/incremental-merkle-tree" {
  export type MerkleNode = bigint;
  export type MerkleProof = {
    root: MerkleNode;
    leaf: MerkleNode;
    siblings: MerkleNode[][];
    pathIndices: number[];
  };

  export class IncrementalMerkleTree {
    constructor(
      hash: (values: MerkleNode[]) => MerkleNode,
      depth: number,
      zeroValue: MerkleNode,
      arity?: number,
      leaves?: MerkleNode[]
    );
    get root(): MerkleNode;
    get depth(): number;
    get leaves(): MerkleNode[];
    insert(leaf: MerkleNode): void;
    createProof(index: number): MerkleProof;
    verifyProof(proof: MerkleProof): boolean;
  }
}
