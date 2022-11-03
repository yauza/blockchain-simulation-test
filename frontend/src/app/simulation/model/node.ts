import {Block} from "./block";
import {NodeType} from "../nodeType";
import * as cytoscape from 'cytoscape';

import {getPriceByEnumName} from "./country";
import { Protocol } from "src/app/utils/constants";

export class Node {
  public blockChainLength: number = 1;
  public mined: number = 0;
  public neighbours: number[] = [];

  private alive: boolean = true;
  public computingPower: number = 0;

  // for miners
  private lastBlock?: Block;

  // for full nodes
  public blockChain?: Block = new Block(-1, -1);
  public blockChainMap: Map<number, Block> = new Map();
  public blockChainSize: number = 0;

  constructor(public readonly id: number,
              public readonly nodeType: NodeType,
              public readonly country: string,
              public money: number) {

    if (this.nodeType == NodeType.Full) {
      this.blockChainMap = new Map();
      this.blockChain = new Block(-1, -1);
      this.blockChainMap.set(-1, this.blockChain);
    }
  }

  public connect(nodeId: number): void {
    if (!this.isConnected(nodeId)) this.neighbours.push(nodeId);
  }

  public detachMiner(minerId: number): void {
    this.neighbours = this.neighbours.filter(el => {
      return el !== minerId;
    })
  }

  public isConnected(minerId: number): boolean {
    return this.neighbours.includes(minerId);
  }

  public settlePayment(paymentAmount: number): boolean {
    paymentAmount *= getPriceByEnumName(this.country)
    if (this.nodeType != NodeType.Miner) {
      return true;
    }
    if (this.money < paymentAmount) {
      // kill the miner
      this.alive = false;
      return false;
    }
    this.money -= paymentAmount;
    return true;
  }

  public receiveReward(reward: number): void {
    this.money += reward;
  }

  public isAlive() {
    return this.alive;
  }

  public getFirst() {
    return this.blockChain;
  }

  public getLast(): Block | undefined {
    // if(this.blockChain) {
    //   let temp = this.blockChain;
    //   while(temp?.next !== null) {
    //     temp = temp?.next;
    //   }
    //   return temp;
    // }
    // return undefined;
    return this.lastBlock;
  }

  // public attachBlock(id: number, minedBy: number): void {
  //   // if(this.blockChain) {
  //   //   let temp = this.blockChain;
  //   //   while(temp?.next !== null) {
  //   //     temp = temp?.next;
  //   //   }
  //   //   temp.next = new Block(id, minedBy);
  //   //   temp.next.previous = temp;
  //   //   return;
  //   // }
  //   // this.blockChain = new Block(id, minedBy);
  //   if (this.nodeType == NodeType.Miner) {
  //     if (this.parentBlock) this
  //   }
  // }

  // for miner nodes - switches parent block
  // for full nodes - adds the block to the blockchain
  public addBlock(block: Block | undefined): void {
    if (!block) return;
    console.log(block)
    if (this.nodeType == NodeType.Full) {
      console.log("full")
      if (this.blockChain && block.parent) {
        console.log("blockchain i parent")
        if (this.blockChainMap.has(block.id)) return;
        if (this.blockChainMap.has(block.parent.id)) {
          this.blockChainMap.get(block.parent.id)?.children?.push(block);
        } else {
          // block without parent is treated as a root child
          this.blockChain.children?.push(block);
        }
        this.blockChainMap.set(block.id, block);
        this.blockChainSize++;
        console.log(this.blockChain)
      }
    } else if (this.nodeType == NodeType.Miner) {
      // console.log("miner")
      this.lastBlock = block;
    }
  }

  // find the "tail" of the blockchain
  public findLastBlock(protocol: Protocol) {
    if (this.nodeType == NodeType.Full && this.blockChain) {
      if (protocol == Protocol.LongestChain) {
        let lastBlock = this.longestPath(this.blockChain).pop();
        if (!lastBlock) return;
        return this.blockChainMap.get(lastBlock);
      } else if (protocol == Protocol.GHOST) {
        this.updateWeights();
        var maxLen = 0;
        var maxWeight = 0;
        var blockId = -1;
        this.ghostPath(this.blockChain, 0, 0, maxWeight, maxLen, blockId);

      } 
    }
  }

  private longestPath(root: Block): number[] {
    if (!root) return [];
    let paths = [];
    for (let child of root.children) {
      paths.push(this.longestPath(child));
    }
    let el: number[] = [];
    let maxLen = 0;
    for (let path of paths) {
      if (path.length > maxLen) {
        maxLen = path?.length;
        el = path;
      }
    }
    el.push(root.id);
    return el;
  }

  private ghostPath(root: Block, weight: number, len: number, maxWeight: number, maxLen: number, blockId: number): void {
    if (!root) {
      if (maxLen < len) {
        maxLen = len;
        maxWeight = weight;
        blockId = root;
      } else if (maxLen == len && maxWeight == weight) {
        maxWeight = weight;
      }
    }

    for (let child of root.children) {
      this.ghostPath(child, weight + root.weight, len + 1, maxWeight, maxLen, blockId)
    }
  }

  // update blocks weights for GHOST
  public updateWeights(): void {
    let visited = new Set();
    let queue: number[] = new Array<number>();
    visited.add(-1);
    queue.push(-1);

    while (queue.length > 0) {
      const v = queue.shift();
      if (!v) break;
      let b = this.blockChainMap.get(v);
      if (!b) break;
      b.weight = 1 + (b.parent ? b.parent.weight + b.children?.length : b.children?.length);
      for (let child of b.children) {
        if (!visited.has(child.id)) {
          visited.add(child.id);
          queue.push(child.id)
        }
      }
    }
  }

}
