import {Injectable} from '@angular/core';
import {Graph} from "../simulation/model/graph";
import {ParametersService} from "./parameters.service";
import {ButtonsService} from "./buttons.service";
import {VisualisationService} from "./visualisation.service";
import {interval, Subscription, tap, zip} from "rxjs";
import {StepService} from "./step.service";
import {EventService} from "./event.service";
import {SimulationEvent} from "../simulation/model/simulation-event";
import {SimulationEventType} from "../simulation/model/simulation-event-type";
import {Node} from "../simulation/model/node";
import {SimulationEventData} from "../simulation/model/simulation-event-data";
import {PaymentService} from "./payment.service";
import {randomIntFromInterval} from "../utils/numbers";
import {MinerService} from "./miner.service";
import {BlockchainService} from "./blockchain.service";
import {NodeType} from "../simulation/nodeType";
import {AddMinerService} from "./add-miner.service";
import {COUNTRIES, getRandomCountryEnumName} from "../simulation/model/country";
import { Block } from '../simulation/model/block';
import {EdgeService} from "./edge.service";
import {MinersDeletingService} from "./miners-deleting.service";
import {TimePeriod} from "../utils/constants";
import {MinersAmountChartService} from "./charts/miners-amount-chart.service";
import {MeanMoneyChartService} from "./charts/mean-money-chart.service";
import {CountryDataSingleMonth} from "./charts/country-data-classes";
import {ProtocolService} from "./protocol.service";

@Injectable({
  providedIn: 'root'
})
export class SimulationService {
  private graph = new Graph(new Map<number, Node>());

  constructor(private parametersService: ParametersService,
              private buttonsService: ButtonsService,
              private visualisationService: VisualisationService,
              private stepService: StepService,
              private eventService: EventService,
              private paymentService: PaymentService,
              private minerService: MinerService,
              private blockchainService: BlockchainService,
              private addMinerService: AddMinerService,
              private edgeService: EdgeService,
              private minersDeletingService: MinersDeletingService,
              private minersAmountChartService: MinersAmountChartService,
              private meanMoneyChartService: MeanMoneyChartService,
              private protocolService: ProtocolService,
  ) {
    this.nextMinerID = this.parametersService.getAllNodes();
  }

  nextId: number = 0;
  minersToDelete: string[] = [];
  deadMiners: Node[] = [];
  nextMinerID: number;

  private addMinerFrequencySubscription: Subscription | undefined;
  private addMinerSubscription: Subscription | undefined;

  public initializeSimulation() {
    zip([
      this.stepService.getStep(),
      this.eventService.getSimulationEvent()])
    .pipe(
      tap(([a, b]) => {
        if (b instanceof SimulationEvent){
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
            case SimulationEventType.UPDATE_LAST_BLOCK:
              this.handleBlockchainUpdate(b.eventData);
              break;
          }

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
              this.deadMiners.push(miner);
              this.minersToDelete.push('' + miner.id)
              miner.neighbours.forEach(neighbour => {
                this.graph.nodes.get(neighbour)?.detachMiner(miner.id);
              })
              this.graph.nodes.delete(miner.id);
              this.minerService.emit();
            }
          })
          this.minersDeletingService.emitMinersToDelete(this.minersToDelete);
          this.minersToDelete = [];
        })
      ).subscribe();

    this.blockchainService.get().subscribe(id => {
      this.nextId = id;
    })

    this.addMinerService.getAddMiner()
      .pipe(
        tap((simulationSpeed: number) => {
          if(simulationSpeed > 0) {
            this.startAddingMiners(simulationSpeed);
          } else {
            this.stopAddingMiners();
          }
          this.edgeService.depleteTTL();
        })
      )
      .subscribe();

    this.minersAmountChartService.getRequest().pipe(
      tap((monthNumber: number) => {
        const data = this.collectMinerAmountData();
        this.minersAmountChartService.addData(data.total, data.country, monthNumber);
        this.minersAmountChartService.emitData();
      })
    ).subscribe();

    this.meanMoneyChartService.getRequest().pipe(
      tap((monthNumber: number) => {
        const meanData = this.collectMeanMoneyData();
        this.meanMoneyChartService.addData(meanData.total, meanData.country, monthNumber);
        this.meanMoneyChartService.emitData();
      })
    ).subscribe();
  }

  private startAddingMiners(simulationSpeed: number) {
    this.addMinerFrequencySubscription = this.parametersService.getAddNewMinerFrequency()
      .pipe(
        tap((timePeriod: number) => {
          if (timePeriod > 0) {
            this.addMinerSubscription = interval(TimePeriod.MONTH_INTERVAL / (timePeriod * simulationSpeed)).pipe(
              tap(() => {
                this.addNewMiner();
                this.visualisationService.emitGraph(this.graph);
              })
            ).subscribe();
          } else {
            this.addMinerSubscription?.unsubscribe();
          }
        })
      ).subscribe();
  }
  private stopAddingMiners() {
    this.addMinerFrequencySubscription?.unsubscribe();
    this.addMinerSubscription?.unsubscribe();
  }

  private addNewMiner() {
    let newMinerId = this.nextMinerID;
    this.nextMinerID += 1;
    const immortalNode = this.getRandomNonMiner();

    const newMiner = new Node(newMinerId, NodeType.Miner, getRandomCountryEnumName(), randomIntFromInterval(50, 150));
    newMiner.computingPower = randomIntFromInterval(1, 10);


    newMiner.connect(immortalNode.id);
    immortalNode.connect(newMiner.id);

    this.graph.nodes.set(newMinerId, newMiner);
  }

  public addNewMinerWithParams(country: string, money: number, computingPower: number){
    let newMinerId = this.nextMinerID;
    this.nextMinerID += 1;
    const immortalNode = this.getRandomNonMiner();

    const newMiner = new Node(newMinerId, NodeType.Miner, country, money); //todo add moeney parameter
    newMiner.computingPower = computingPower;


    newMiner.connect(immortalNode.id);
    immortalNode.connect(newMiner.id);

    this.graph.nodes.set(newMinerId, newMiner);
  }

  private handleInitialization(): void {
    this.graph = Graph.generateGraph(this.parametersService.getFullNodes(), this.parametersService.getMinerNodes(), this.parametersService.getLightNodes(), this.parametersService.getListeningNodes(), this.parametersService.getInitialMinersData());
  }

  private handleBlockMined(eventData: SimulationEventData): void {
    let allMiners: number[] = [];
    this.graph.nodes.forEach((value: Node, key: number) => {
      if(value.nodeType == NodeType.Miner){
        for (let i = 0; i < value.computingPower; i++){
          allMiners.push(key)
        }
      }
    })

    let randArrayIndex = randomIntFromInterval(0, allMiners.length - 1);
    let minerId = allMiners[randArrayIndex];
    let minerNode = this.graph.nodes.get(minerId);

    if (minerNode === undefined) return;

    let newBlock = new Block(this.nextId, minerNode.id, minerNode.getParent());
    minerNode.mineBlock(newBlock);
    this.blockchainService.emit();

    minerNode.mined++;
    minerNode.blockChainLength++;
    minerNode.receiveReward(this.parametersService.getReward());

    minerNode.neighbours.forEach((neighbour) => {
      let responseEventData = new SimulationEventData();
      responseEventData.senderId = minerId;
      responseEventData.receiverId = neighbour;
      this.edgeService.addEdge(responseEventData.senderId, responseEventData.receiverId);
      this.edgeService.addEdge(responseEventData.receiverId, responseEventData.senderId);
      this.eventService.emitSimulationEvent(new SimulationEvent(SimulationEventType.BLOCK_RECEIVED, responseEventData));
    })
    this.edgeService.depleteTTL();
  }

  private handleBlockReceived(eventData: SimulationEventData): void {
    let senderNode = this.graph?.nodes.get(eventData.senderId)
    let receiverNode = this.graph?.nodes.get(eventData.receiverId)
    if (!senderNode) return;
    if (!receiverNode) return;

    const receivedBlock = senderNode.getLast(this.protocolService.protocol);
    const currLastBlock = receiverNode.getLast(this.protocolService.protocol);

    if (currLastBlock?.id != receivedBlock?.id) {
      receiverNode.addBlock(receivedBlock)

      receiverNode.neighbours.forEach((neighbour) => {
        if(neighbour === eventData.senderId) return;

        let responseEventData = new SimulationEventData();
        responseEventData.senderId = eventData.receiverId;
        responseEventData.receiverId = neighbour;

        this.edgeService.addEdge(responseEventData.senderId, responseEventData.receiverId);
        this.edgeService.addEdge(responseEventData.receiverId, responseEventData.senderId);
        this.eventService.emitSimulationEvent(new SimulationEvent(SimulationEventType.BLOCK_RECEIVED, responseEventData));
      })
      this.edgeService.depleteTTL();
  }
  }

  // step to update miner's last block - block to attach new blocks to
  private handleBlockchainUpdate(eventData: SimulationEventData) {
    let maxFullNode = Array.from(this.graph.nodes.values())
      .filter((node) => node.nodeType == NodeType.Full)
      .reduce((p, v) => {
        return (p.blockChainSize > v.blockChainSize ? p : v);
      });

    maxFullNode.neighbours.forEach((neighbour) => {
      let updateEventData = new SimulationEventData();
      updateEventData.senderId = maxFullNode.id;
      updateEventData.receiverId = neighbour;
      this.eventService.emitSimulationEvent(new SimulationEvent(SimulationEventType.BLOCK_RECEIVED, updateEventData));
    })
  }


  public getMiners() {
    return Array.from(this.graph.nodes.values()).filter((value, index) => value.nodeType == NodeType.Miner || value.money > 0);
  }

  private getRandomNonMiner(): Node {
    const nonMiners = this.getNonMiners();
    return nonMiners[Math.floor(Math.random() * nonMiners.length)];
  }

  private getNonMiners(): Node[] {
    return Array.from(this.graph.nodes.values()).filter((value, index) => value.nodeType != NodeType.Miner);
  }

  private collectMinerAmountData() {
    const miners = this.getMiners();

    const totalCount = miners.length;

    let counter = {
      romania: 0,
      poland: 0,
      spain: 0,
      germany: 0,
      greatBritain: 0
    };

    miners.forEach(miner => {
      switch (miner.country) {
        case COUNTRIES[0].enumName:
          counter.romania++;
          break;
        case COUNTRIES[1].enumName:
          counter.poland++;
          break;
        case COUNTRIES[2].enumName:
          counter.spain++;
          break;
        case COUNTRIES[3].enumName:
          counter.germany++;
          break;
        case COUNTRIES[4].enumName:
          counter.greatBritain++;
          break;
        default:
          console.log("NO SUCH COUNTRY");
          break;
      }
    });

    const byCountry = new CountryDataSingleMonth(
      counter.romania.toString(),
      counter.poland.toString(),
      counter.spain.toString(),
      counter.germany.toString(),
      counter.greatBritain.toString()
    );

    return {
      total: totalCount.toString(),
      country: byCountry
    }
  }

  private collectMeanMoneyData() {
    const miners = this.getMiners();

    const totalCount = miners.length !== 0 ? miners.length : 1;

    let counter = {
      romania: 0,
      poland: 0,
      spain: 0,
      germany: 0,
      greatBritain: 0
    };

    let moneySum = {
      romania: 0,
      poland: 0,
      spain: 0,
      germany: 0,
      greatBritain: 0
    };

    let totalSum: number = 0;

    miners.forEach(miner => {
      totalSum += miner.money;
      switch (miner.country) {
        case COUNTRIES[0].enumName:
          counter.romania++;
          moneySum.romania += miner.money;
          break;
        case COUNTRIES[1].enumName:
          counter.poland++;
          moneySum.poland += miner.money;
          break;
        case COUNTRIES[2].enumName:
          counter.spain++;
          moneySum.spain += miner.money;
          break;
        case COUNTRIES[3].enumName:
          counter.germany++;
          moneySum.germany += miner.money;
          break;
        case COUNTRIES[4].enumName:
          counter.greatBritain++;
          moneySum.greatBritain += miner.money;
          break;
        default:
          console.log("NO SUCH COUNTRY");
          break;
      }
    });

    for (let counterKey in counter) {
      if (counter[counterKey] === 0)
        counter[counterKey] = 1;
    }

    const meanByCountry = new CountryDataSingleMonth(
      (moneySum.romania / counter.romania).toString(),
      (moneySum.poland / counter.poland).toString(),
      (moneySum.spain / counter.spain).toString(),
      (moneySum.germany / counter.germany).toString(),
      (moneySum.greatBritain / counter.greatBritain).toString()
    );

    const meanTotal = (totalSum / totalCount).toString();

    return {
      total: meanTotal,
      country: meanByCountry
    }
  }
}
