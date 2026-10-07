/**
 * 应急送水车调度台账的领域模型、片区/车辆/点位档案与播种数据。
 * 纯前端，无后端：结构按以后能直接映射成接口返回值来写，换回后端时页面不用大改。
 */

export type DistrictCode = 'east' | 'west' | 'south' | 'north'

/** 趟次状态：待出车（调度项可改）→ 已出车（整条只读，只允许一次性回填到场核量）→ 已完成 */
export type TripStatus = '待出车' | '已出车' | '已完成'
/** 派车单状态：待审核（含待纠正）→ 已打回（越权）/ 已派车（成功并生成趟次） */
export type OrderStatus = '待审核' | '已派车' | '已打回'
/** 客服停水待办状态：由关联趟次派生，列表页与明细共用同一份读数 */
export type TodoStatus = '待派车' | '已派车' | '已送水'

export interface District {
  code: DistrictCode
  name: string
}

export interface Truck {
  id: string
  plate: string
  district: DistrictCode
  capacityTons: number
}

export interface DeliveryPoint {
  id: string
  name: string
  district: DistrictCode
  address: string
}

/** 客服受理的停水待办：缺口量是「用户报的那版」 */
export interface OutageTodo {
  id: number
  code: string
  pointId?: string
  location: string
  district: DistrictCode
  contact: string
  phone: string
  gapTons: number
  households: number
  receivedAt: string
  status: TodoStatus
  tripId?: number
}

/** 派车单：别的片区递上来也进同一只收件箱，由本片区调度员受理 */
export interface DispatchOrder {
  id: number
  code: string
  fromDistrict: DistrictCode
  applicant: string
  status: OrderStatus
  pointId: string
  truckId: string
  tripCode: string
  tons: number
  eta: string
  todoId?: number
  tripId?: number
  /** 越权被打回时，写明越在哪一项 */
  rejectItems: string[]
  rejectReason: string
  createdAt: string
}

/** 送水趟次台账：一辆车一趟，一条记录 */
export interface Trip {
  id: number
  /** 送水编号，全局唯一 */
  code: string
  pointId: string
  truckId: string
  /** 趟次归属片区 = 送水点位归属片区，调度权限以它为准 */
  district: DistrictCode
  /** 派车时登记的送水量（按用户缺口派的那版） */
  plannedTons: number
  /** 预计到场时间（派车时挂到台账上的到场时间） */
  eta: string
  /** 实际到场时间（出车后一次性回填的送达凭据） */
  arrivedAt: string
  /** 现场核量：到场后一次性回填，与缺口打架时以这版为准 */
  measuredTons: number | null
  status: TripStatus
  dispatcherDistrict: DistrictCode
  dispatcher: string
  dispatchedAt: string
  todoId?: number
  orderId?: number
}

export interface ActingDispatcher {
  district: DistrictCode
  name: string
}

/** 越权/校验结果：越权时逐项给出「越在哪一项」 */
export interface AuthIssue {
  item: string
  message: string
}

export interface DispatchResult {
  ok: boolean
  message: string
  /** 越权项；非空表示按越权打回 */
  issues?: AuthIssue[]
  tripId?: number
}

export interface TodoDraft {
  pointId?: string
  location: string
  district: DistrictCode
  contact: string
  phone: string
  gapTons: number
  households: number
  receivedAt: string
}

export interface OrderDraft {
  pointId: string
  truckId: string
  tripCode: string
  tons: number
  eta: string
  todoId?: number
}

export const DISTRICTS: District[] = [
  { code: 'east', name: '城东片区' },
  { code: 'west', name: '城西片区' },
  { code: 'south', name: '城南片区' },
  { code: 'north', name: '城北片区' },
]

/** 各片区可登录的调度员：用来演示「只有本片区调度员能派车/改点位」 */
export const DISPATCHERS: Record<DistrictCode, { name: string; title: string }> = {
  east: { name: '张伟', title: '城东片区调度员' },
  west: { name: '李娜', title: '城西片区调度员' },
  south: { name: '王强', title: '城南片区调度员' },
  north: { name: '赵敏', title: '城北片区调度员' },
}

export const TRUCKS: Truck[] = [
  { id: 'E1', plate: '苏A·E001', district: 'east', capacityTons: 5 },
  { id: 'E2', plate: '苏A·E002', district: 'east', capacityTons: 8 },
  { id: 'W1', plate: '苏A·W001', district: 'west', capacityTons: 10 },
  { id: 'W2', plate: '苏A·W002', district: 'west', capacityTons: 8 },
  { id: 'S1', plate: '苏A·S001', district: 'south', capacityTons: 12 },
  { id: 'N1', plate: '苏A·N001', district: 'north', capacityTons: 6 },
]

export const POINTS: DeliveryPoint[] = [
  { id: 'P-E-1', name: '城东花园小区', district: 'east', address: '城东大道 88 号' },
  { id: 'P-E-2', name: '东环路小学', district: 'east', address: '东环路 210 号' },
  { id: 'P-W-1', name: '城西批发市场', district: 'west', address: '西园路 16 号' },
  { id: 'P-W-2', name: '西园新村', district: 'west', address: '西大街 302 号' },
  { id: 'P-S-1', name: '南湖雅苑', district: 'south', address: '南湖大街 66 号' },
  { id: 'P-N-1', name: '北苑医院', district: 'north', address: '北苑路 9 号' },
]

export interface WatertruckState {
  todos: OutageTodo[]
  orders: DispatchOrder[]
  trips: Trip[]
}

/** 首次打开时的示例数据；改动存在浏览器本地，重置才回到这份。 */
export function buildSeedState(): WatertruckState {
  const todos: OutageTodo[] = [
    {
      id: 1,
      code: 'GS-20261007-001',
      pointId: 'P-E-1',
      location: '城东花园小区',
      district: 'east',
      contact: '周老师',
      phone: '138****0001',
      gapTons: 12,
      households: 320,
      receivedAt: '2026-10-07 08:10',
      status: '待派车',
    },
    {
      id: 2,
      code: 'GS-20261007-002',
      pointId: 'P-W-2',
      location: '西园新村',
      district: 'west',
      contact: '吴阿姨',
      phone: '139****0002',
      gapTons: 6,
      households: 150,
      receivedAt: '2026-10-07 08:35',
      status: '待派车',
    },
    {
      id: 3,
      code: 'GS-20261007-003',
      pointId: 'P-S-1',
      location: '南湖雅苑',
      district: 'south',
      contact: '郑经理',
      phone: '137****0003',
      gapTons: 20,
      households: 560,
      receivedAt: '2026-10-07 09:02',
      status: '待派车',
    },
    {
      id: 4,
      code: 'GS-20261007-004',
      pointId: 'P-N-1',
      location: '北苑医院',
      district: 'north',
      contact: '后勤孙主任',
      phone: '136****0004',
      gapTons: 8,
      households: 0,
      receivedAt: '2026-10-07 09:20',
      status: '待派车',
    },
    {
      id: 5,
      code: 'GS-20261007-005',
      pointId: 'P-E-2',
      location: '东环路小学',
      district: 'east',
      contact: '马校长',
      phone: '135****0005',
      gapTons: 5,
      households: 900,
      receivedAt: '2026-10-07 07:50',
      status: '已派车',
      tripId: 1,
    },
    {
      id: 6,
      code: 'GS-20261007-006',
      pointId: 'P-W-1',
      location: '城西批发市场',
      district: 'west',
      contact: '市场管理处',
      phone: '134****0006',
      gapTons: 10,
      households: 210,
      receivedAt: '2026-10-07 06:40',
      status: '已送水',
      tripId: 2,
    },
  ]

  const trips: Trip[] = [
    {
      id: 1,
      code: 'SS-20261007-01',
      pointId: 'P-E-2',
      truckId: 'E2',
      district: 'east',
      plannedTons: 5,
      eta: '2026-10-07 10:00',
      arrivedAt: '',
      measuredTons: null,
      status: '待出车',
      dispatcherDistrict: 'east',
      dispatcher: '张伟',
      dispatchedAt: '2026-10-07 08:20',
      todoId: 5,
    },
    {
      id: 2,
      code: 'SS-20261007-02',
      pointId: 'P-W-1',
      truckId: 'W1',
      district: 'west',
      plannedTons: 10,
      eta: '2026-10-07 08:30',
      arrivedAt: '2026-10-07 08:42',
      // 现场只核到 7 吨，和用户报的 10 吨缺口打架 → 以这版为准
      measuredTons: 7,
      status: '已出车',
      dispatcherDistrict: 'west',
      dispatcher: '李娜',
      dispatchedAt: '2026-10-07 07:30',
      todoId: 6,
    },
  ]

  const orders: DispatchOrder[] = [
    {
      id: 1,
      code: 'PC-20261007-001',
      // 城南片区递上来、请城东片区出车的单：点位归城东，城东受理即合规
      fromDistrict: 'south',
      applicant: '王强',
      status: '待审核',
      pointId: 'P-E-1',
      truckId: 'E1',
      tripCode: 'SS-20261007-03',
      tons: 12,
      eta: '2026-10-07 11:00',
      todoId: 1,
      rejectItems: [],
      rejectReason: '',
      createdAt: '2026-10-07 09:15',
    },
    {
      id: 2,
      code: 'PC-20261007-002',
      // 城北调度员误派城东点位的单：已按越权打回，可在切到城东后重试
      fromDistrict: 'north',
      applicant: '赵敏',
      status: '已打回',
      pointId: 'P-E-1',
      truckId: 'N1',
      tripCode: 'SS-20261007-04',
      tons: 12,
      eta: '2026-10-07 11:30',
      todoId: 1,
      rejectItems: ['送水点位', '送水车辆'],
      rejectReason: '送水点位、送水车辆均不归属城北片区，跨片区派车属越权，已打回。',
      createdAt: '2026-10-07 09:25',
    },
  ]

  return { todos, orders, trips }
}
