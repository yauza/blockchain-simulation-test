import {Injectable} from '@angular/core';
import {Graph} from "../simulation/model/graph";
import {ParametersService} from "./parameters.service";
import {ButtonsService} from "./buttons.service";
import {VisualisationService} from "./visualisation.service";
import {tap, zip} from "rxjs";
import {StepService} from "./step.service";
import {EventService} from "./event.service";
import {SimulationEvent} from "../simulation/model/simulation-event";
import {SimulationEventType} from "../simulation/model/simulation-event-type";
import {MinerNode} from "../simulation/model/miner-node";
import {SimulationEventData} from "../simulation/model/simulation-event-data";
import {PaymentService} from "./payment.service";
import {randomIntFromInterval} from "../utils/numbers";
import {MinerService} from "./miner.service";
import {BlockchainService} from "./blockchain.service";
import {Block} from "../simulation/model/block";

@Injectable({
  providedIn: 'root'
})
export class SimulationService {
  private graph = new Graph(new Map<number, MinerNode>());

  constructor(private parametersService: ParametersService,
              private buttonsService: ButtonsService,
              private visualisationService: VisualisationService,
              private stepService: StepService,
              private eventService: EventService,
              private paymentService: PaymentService,
              private minerService: MinerService,
              private blockchainService: BlockchainService,
  ) { }

  nextId: number = 0;


  public initializeSimulation() {
    zip([
      this.stepService.getStep(),
      this.eventService.getSimulationEvent()])
    .pipe(
      //tap(() => console.log('zipped')),
      tap(([a, b]) => {
        if (b instanceof SimulationEvent){
          //console.log('handling event ' + b.eventType);
          switch (b.eventType) {
            case SimulationEventType.INITIALIZATION:
              this.handleInitialization();
              break;
            case SimulationEventType.BLOCK_MINED:
              this.handleBlockMined(b.eventData);
              break;
            case SimulationEventType.BLOCK_RECEIVED:
              this.handleBlockReceived(b.eventData);
              break;
          }

          //console.log('emiting graph');
          this.visualisationService.emitGraph(this.graph);
          this.minerService.emit();
        }
        this.stepService.unblockSemaphore();
      })
    ).subscribe();

    this.paymentService.getPayment()
      .pipe(
        tap(paymentAmount => {
          this.graph.nodes.forEach(miner => {
            if (!miner.settlePayment(paymentAmount)) {
              miner.neighbours.forEach(neighbour => {
                this.graph.nodes.get(neighbour)?.detachMiner(miner.id);
                if(this.graph.nodes.get(neighbour)?.neighbours.length === 0 && this.graph.nodes.size > 1) {
                  let randomKey = this.getRandomNodeKey();
                  console.log(`Random key generated ${randomKey}`);
                  while(randomKey === neighbour || !this.graph.nodes.get(randomKey)?.isAlive()) {
                    randomKey = this.getRandomNodeKey();
                  }
                  this.graph.nodes.get(neighbour)?.neighbours.push(randomKey);
                }
              })
              this.graph.nodes.delete(miner.id);
              this.minerService.emit();
            }
          })
        })
      ).subscribe();

    this.blockchainService.get().subscribe(id => {
      this.nextId = id;
    })
  }

  private handleInitialization(): void {
    this.graph = Graph.generateGraph(this.parametersService.getFullNodes(), this.parametersService.getMinerNodes(), this.parametersService.getLightNodes(), this.parametersService.getListeningNodes());
  }

  private handleBlockMined(eventData: SimulationEventData): void {
    let allMiners = Array.from(this.graph.nodes.keys());

    let randArrayIndex = randomIntFromInterval(0, allMiners.length - 1);
    let minerId = allMiners[randArrayIndex];
    let minerNode = this.graph.nodes.get(minerId);

    if (minerNode === undefined) return;

    minerNode.attachBlock(this.nextId, minerNode.id);
    this.blockchainService.emit();

    console.log(this.graph.nodes);

    minerNode.mined++;
    minerNode.blockChainLength++;
    minerNode.receiveReward(this.parametersService.getReward());

    minerNode.neighbours.forEach((neighbour) => {
      let responseEventData = new SimulationEventData();
      responseEventData.senderId = minerId;
      responseEventData.receiverId = neighbour;
      this.eventService.emitSimulationEvent(new SimulationEvent(SimulationEventType.BLOCK_RECEIVED, responseEventData));
    })
  }

  private handleBlockReceived(eventData: SimulationEventData): void {
    let senderNode = this.graph?.nodes.get(eventData.senderId)
    let receiverNode = this.graph?.nodes.get(eventData.receiverId)
    if (!senderNode) return;
    if (!receiverNode) return;

    if (receiverNode.blockChainLength < senderNode.blockChainLength) {
      receiverNode.blockChainLength = senderNode.blockChainLength;

      const receivedBlock = senderNode.getLast();

      if(receiverNode) {
        receiverNode.attachBlock(receivedBlock!.id, receivedBlock!.minedBy);
      }

      receiverNode.neighbours.forEach((neighbour) => {
        if(neighbour === eventData.senderId) return;

        let responseEventData = new SimulationEventData();
        responseEventData.senderId = eventData.receiverId;
        responseEventData.receiverId = neighbour;
        this.eventService.emitSimulationEvent(new SimulationEvent(SimulationEventType.BLOCK_RECEIVED, responseEventData));
      })
    }
  }

  private getRandomNodeKey() {
    let keys = Array.from(this.graph.nodes.keys());
    return keys[Math.floor(Math.random() * keys.length)];
  }

  public getMiners() {
    return Array.from(this.graph.nodes.values());
  }


}
