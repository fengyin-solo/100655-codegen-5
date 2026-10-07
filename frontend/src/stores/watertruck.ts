import { defineStore } from 'pinia'

import {
  buildSeedState,
  DISPATCHERS,
  POINTS,
  TRUCKS,
} from '@/data/watertruck'
import type {
  ActingDispatcher,
  AuthIssue,
  DispatchOrder,
  DispatchResult,
  DistrictCode,
  OrderDraft,
  OutageTodo,
  TodoDraft,
  Trip,
  TripStatus,
  WatertruckState,
} from '@/data/watertruck'

// 本地持久化：刷新、关掉再打开都还在，重置才回到播种数据。
const STORAGE_KEY = 'waterworks-ops:watertruck'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowText(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function readState(): WatertruckState {
  const seed = buildSeedState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return seed
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed))
    return seed
  }
  try {
    return { ...seed, ...(JSON.parse(raw) as WatertruckState) }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed))
    return seed
  }
}

const pointById = (id: string) => POINTS.find((p) => p.id === id)
const truckById = (id: string) => TRUCKS.find((t) => t.id === id)

export const useWatertruckStore = defineStore('watertruck', {
  state: () => ({
    todos: [] as OutageTodo[],
    orders: [] as DispatchOrder[],
    trips: [] as Trip[],
    loaded: false,
  }),

  getters: {
    pointName: () => (id: string) => pointById(id)?.name ?? id,
    truckPlate: () => (id: string) => truckById(id)?.plate ?? id,
    districtName: () => (code: DistrictCode) =>
      ({ east: '城东片区', west: '城西片区', south: '城南片区', north: '城北片区' })[code],

    /** 一趟车是否处在「出车后」的只读区间（已出车/已完成整条只读） */
    isLocked: () => (trip: Trip) => trip.status !== '待出车',

    /**
     * 客服待办的统一读数：状态与对应趟次全部从同一份 trips 派生，
     * 列表页和明细页都走这里，保证两处读到的趟次一致。
     */
    todoViews: (state) => {
      return state.todos.map((todo) => {
        const trip = todo.tripId != null ? state.trips.find((t) => t.id === todo.tripId) : undefined
        // 现场核量与用户报的缺口打架时，以现场核量那版为准；没核量才回退到派车量。
        const effectiveTons = trip ? (trip.measuredTons ?? trip.plannedTons) : null
        let reconcile: '未派车' | '待核量' | '足量' | '不足' | '超量' = '未派车'
        if (trip) {
          if (trip.measuredTons == null) {
            reconcile = '待核量'
          } else if (trip.measuredTons >= todo.gapTons) {
            reconcile = trip.measuredTons > todo.gapTons ? '超量' : '足量'
          } else {
            reconcile = '不足'
          }
        }
        return { todo, trip, effectiveTons, reconcile }
      })
    },
  },

  actions: {
    hydrate() {
      if (this.loaded) return
      const state = readState()
      this.todos = state.todos
      this.orders = state.orders
      this.trips = state.trips
      this.loaded = true
    },

    persist() {
      if (typeof window === 'undefined' || !window.localStorage) return
      const payload: WatertruckState = { todos: this.todos, orders: this.orders, trips: this.trips }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    },

    resetAll() {
      const seed = buildSeedState()
      this.todos = seed.todos
      this.orders = seed.orders
      this.trips = seed.trips
      this.persist()
    },

    nextId(rows: { id: number }[]): number {
      return rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
    },

    // ---------- 客服受理 ----------

    addTodo(draft: TodoDraft): OutageTodo {
      const id = this.nextId(this.todos)
      const code = `GS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(id).padStart(3, '0')}`
      const todo: OutageTodo = {
        id,
        code,
        pointId: draft.pointId,
        location: draft.location,
        district: draft.district,
        contact: draft.contact,
        phone: draft.phone,
        gapTons: draft.gapTons,
        households: draft.households,
        receivedAt: draft.receivedAt || nowText(),
        status: '待派车',
      }
      this.todos.unshift(todo)
      this.persist()
      return todo
    },

    // ---------- 派车单 ----------

    /**
     * 登记一张待审核派车单（受理箱）。别的片区递上来也先落到这里，
     * 真正的越权判定在受理（dispatchOrder）那一刻做。
     */
    submitOrderDraft(draft: OrderDraft, actor: ActingDispatcher): DispatchOrder {
      const order: DispatchOrder = {
        id: this.nextId(this.orders),
        code: `PC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(this.nextId(this.orders)).padStart(3, '0')}`,
        fromDistrict: actor.district,
        applicant: actor.name,
        status: '待审核',
        pointId: draft.pointId,
        truckId: draft.truckId,
        tripCode: draft.tripCode,
        tons: draft.tons,
        eta: draft.eta,
        todoId: draft.todoId,
        rejectItems: [],
        rejectReason: '',
        createdAt: nowText(),
      }
      this.orders.unshift(order)
      this.persist()
      return order
    },

    /**
     * 受理派车单：本片区调度员才能把本片区点位的单派出去。
     * 越权 → 单打回并逐项写明越在哪一项；编号重复/车辆占用 → 不派车、提示并可重试；
     * 通过 → 生成一趟只读前可改的趟次，并把动作反映到客服待办。
     */
    dispatchOrder(orderId: number, actor: ActingDispatcher): DispatchResult {
      const order = this.orders.find((o) => o.id === orderId)
      if (!order) return { ok: false, message: '没有找到这张派车单' }
      if (order.status === '已派车') {
        return { ok: false, message: '这张派车单已经派车，不用重复受理' }
      }

      const point = pointById(order.pointId)
      const truck = truckById(order.truckId)

      // 1) 越权检查：只放行「点位、车辆都归属受理人片区」的单。
      const issues: AuthIssue[] = []
      if (!point || point.district !== actor.district) {
        issues.push({
          item: '送水点位',
          message: `送水点位「${point?.name ?? order.pointId}」不归属${this.districtName(actor.district)}，${this.districtName(actor.district)}无权对其派车`,
        })
      }
      if (!truck || truck.district !== actor.district) {
        issues.push({
          item: '送水车辆',
          message: `送水车辆「${truck?.plate ?? order.truckId}」不归属${this.districtName(actor.district)}，${this.districtName(actor.district)}无权跨区调车`,
        })
      }
      if (issues.length > 0) {
        order.status = '已打回'
        order.rejectItems = issues.map((i) => i.item)
        order.rejectReason = issues.map((i) => i.message).join('；') + '。'
        this.persist()
        return {
          ok: false,
          issues,
          message: `越权打回：${order.rejectReason}`,
        }
      }

      // 2) 本片区受理：再做业务校验，失败不打回、保留单据以便重试。
      const sameCode = order.tripCode.trim()
      if (this.trips.some((t) => t.code === sameCode)) {
        order.status = '待审核'
        order.rejectItems = []
        order.rejectReason = ''
        this.persist()
        return { ok: false, message: `送水编号「${order.tripCode}」已登记，同一编号不许登记两遍，请改号后重试` }
      }
      // 同一编号也不许同时挂在别的待处理派车单上（当前单重试自己不算重复）。
      if (this.orders.some((x) => x.id !== order.id && x.status !== '已派车' && x.tripCode.trim() === sameCode)) {
        order.status = '待审核'
        order.rejectItems = []
        order.rejectReason = ''
        this.persist()
        return { ok: false, message: `送水编号「${order.tripCode}」已被另一张待处理派车单占用，同一编号不许登记两遍，请改号后重试` }
      }
      const busy = this.trips.find((t) => t.truckId === order.truckId && t.status !== '已完成')
      if (busy) {
        order.status = '待审核'
        order.rejectItems = []
        order.rejectReason = ''
        this.persist()
        return { ok: false, message: `车辆「${truck!.plate}」已有在途趟次（${busy.code}），一辆车一趟，请换车后重试` }
      }

      // 3) 校验通过：生成趟次台账。
      const tripId = this.nextId(this.trips)
      const trip: Trip = {
        id: tripId,
        code: order.tripCode.trim(),
        pointId: order.pointId,
        truckId: order.truckId,
        district: point!.district,
        plannedTons: order.tons,
        eta: order.eta,
        arrivedAt: '',
        measuredTons: null,
        status: '待出车',
        dispatcherDistrict: actor.district,
        dispatcher: actor.name,
        dispatchedAt: nowText(),
        todoId: order.todoId,
        orderId: order.id,
      }
      this.trips.unshift(trip)

      // 派车动作反映到客服受理的停水待办：同一份数据，列表与明细读到的趟次一致。
      if (order.todoId != null) {
        const todo = this.todos.find((t) => t.id === order.todoId)
        if (todo) {
          todo.tripId = trip.id
          todo.status = '已派车'
        }
      }

      order.status = '已派车'
      order.tripId = trip.id
      order.rejectItems = []
      order.rejectReason = ''
      this.persist()
      return { ok: true, message: `派车成功，已登记趟次「${trip.code}」并同步客服待办`, tripId }
    },

    /**
     * 改派车单草稿（打回后或业务校验失败后的重试）：改掉越界项再受理。
     * 只动未派车的单；已派车的单不可再改。
     */
    reviseOrder(orderId: number, patch: Partial<OrderDraft>): DispatchResult {
      const order = this.orders.find((o) => o.id === orderId)
      if (!order) return { ok: false, message: '没有找到这张派车单' }
      if (order.status === '已派车') return { ok: false, message: '已派车的派车单不能修改' }
      if (patch.pointId !== undefined) order.pointId = patch.pointId
      if (patch.truckId !== undefined) order.truckId = patch.truckId
      if (patch.tripCode !== undefined) order.tripCode = patch.tripCode
      if (patch.tons !== undefined) order.tons = patch.tons
      if (patch.eta !== undefined) order.eta = patch.eta
      // 重新进入受理：清掉上一版打回痕迹。
      order.status = '待审核'
      order.rejectItems = []
      order.rejectReason = ''
      this.persist()
      return { ok: true, message: '派车单已更新，可以重新受理' }
    },

    // ---------- 趟次台账 ----------

    /**
     * 改待出车趟次的派车项（点位/水量/到场时间/车辆）。
     * 只有本片区调度员能改；出车后整条只读，本片区也不能再改。
     */
    updateTrip(
      tripId: number,
      actor: ActingDispatcher,
      patch: Partial<Pick<Trip, 'pointId' | 'plannedTons' | 'eta' | 'truckId' | 'code'>>,
    ): DispatchResult {
      const trip = this.trips.find((t) => t.id === tripId)
      if (!trip) return { ok: false, message: '没有找到这趟送水记录' }
      if (trip.status !== '待出车') {
        return { ok: false, message: `趟次「${trip.code}」已${trip.status}，整条只读，本片区也不能再改` }
      }
      if (trip.district !== actor.district) {
        return {
          ok: false,
          message: `这趟送水归${this.districtName(trip.district)}，${this.districtName(actor.district)}改点位属越权，已拒绝`,
        }
      }
      if (patch.code !== undefined && patch.code.trim() !== trip.code) {
        if (this.trips.some((t) => t.id !== trip.id && t.code === patch.code!.trim())) {
          return { ok: false, message: `送水编号「${patch.code}」已登记，同一编号不许登记两遍` }
        }
        trip.code = patch.code.trim()
      }
      if (patch.pointId !== undefined) {
        const point = pointById(patch.pointId)
        if (!point || point.district !== actor.district) {
          return { ok: false, message: `只能改到${this.districtName(actor.district)}的点位，跨片区改点位越权` }
        }
        trip.pointId = patch.pointId
        trip.district = point.district
      }
      if (patch.truckId !== undefined) {
        const truck = truckById(patch.truckId)
        if (!truck || truck.district !== actor.district) {
          return { ok: false, message: `只能改派${this.districtName(actor.district)}的车辆，跨片区调车越权` }
        }
        const busy = this.trips.find((t) => t.id !== trip.id && t.truckId === truck.id && t.status !== '已完成')
        if (busy) return { ok: false, message: `车辆「${truck.plate}」已有在途趟次（${busy.code}），请换车` }
        trip.truckId = truck.id
      }
      if (patch.plannedTons !== undefined) trip.plannedTons = patch.plannedTons
      if (patch.eta !== undefined) trip.eta = patch.eta
      this.persist()
      return { ok: true, message: `趟次「${trip.code}」已更新` }
    },

    /**
     * 确认出车：一趟送水从这一刻起整条只读（调度列冻结）。
     * 只有本片区调度员能确认。
     */
    markDeparted(tripId: number, actor: ActingDispatcher): DispatchResult {
      const trip = this.trips.find((t) => t.id === tripId)
      if (!trip) return { ok: false, message: '没有找到这趟送水记录' }
      if (trip.status !== '待出车') return { ok: false, message: `趟次「${trip.code}」已出车，不能重复确认` }
      if (trip.district !== actor.district) {
        return { ok: false, message: `这趟送水归${this.districtName(trip.district)}，${this.districtName(actor.district)}无权确认出车` }
      }
      trip.status = '已出车'
      this.persist()
      return { ok: true, message: `趟次「${trip.code}」已出车，台账转为只读` }
    },

    /**
     * 现场回填到场时间与现场核量。这是出车后的「送达凭据」，单列追加，
     * 不改任何派车台账列，所以不破坏已出车趟次整条只读。
     * 现场核量与用户报的缺口打架时，以现场核量那版为准（todoViews 已按此取数）。
     */
    recordArrival(tripId: number, arrivedAt: string, measuredTons: number): DispatchResult {
      const trip = this.trips.find((t) => t.id === tripId)
      if (!trip) return { ok: false, message: '没有找到这趟送水记录' }
      if (trip.status === '待出车') return { ok: false, message: '车辆尚未出车，到场核量请在出车后登记' }
      if (trip.measuredTons != null) {
        return { ok: false, message: `趟次「${trip.code}」已做过现场核量，凭据一次性记录、不可修改` }
      }
      trip.arrivedAt = arrivedAt
      trip.measuredTons = measuredTons
      if (trip.todoId != null) {
        const todo = this.todos.find((t) => t.id === trip.todoId)
        if (todo) todo.status = '已送水'
      }
      this.persist()
      return { ok: true, message: `趟次「${trip.code}」已回填到场时间与现场核量 ${measuredTons} 吨` }
    },

    /** 车辆归队，趟次收口（仍整条只读）。 */
    completeTrip(tripId: number): DispatchResult {
      const trip = this.trips.find((t) => t.id === tripId)
      if (!trip) return { ok: false, message: '没有找到这趟送水记录' }
      if (trip.status === '待出车') return { ok: false, message: '车辆还没出车' }
      if (trip.measuredTons == null) return { ok: false, message: '请先登记现场核量，再办理归队' }
      trip.status = '已完成' as TripStatus
      this.persist()
      return { ok: true, message: `趟次「${trip.code}」已完成` }
    },
  },
})

/** 供页面取当前登录调度员身份（片区 + 姓名） */
export function actingDispatcher(district: DistrictCode): ActingDispatcher {
  return { district, name: DISPATCHERS[district].name }
}
