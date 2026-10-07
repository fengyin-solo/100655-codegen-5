import { filterRows } from '@/api/local-service'
import { listRows, saveMulti } from '@/data/local-store'
import type { ActionResult, EntryRow, PageResult } from '@/data/types'

// 应急送水车调度台账：一辆车一趟送水，送水编号全局唯一。
export const TRIP_KEY = 'watertruck'
// 客服受理的停水待办：派车动作会回写这里，列表页和明细都从这一份数据读。
export const TODO_KEY = 'outagetodo'

export const DISTRICTS = ['城东片区', '城西片区', '城南片区', '城北片区']
export const TRIP_STATUSES = ['待派车', '已出车']
export const TODO_STATUSES = ['待派车', '送水中', '已送达']

const DISPATCHED = '已出车'

export type TripInput = {
  送水编号: string
  车牌号: string
  所属片区: string
  送水点位: string
  送水量: string
  到场时间: string
  关联停水待办: string
}

export type TodoDetail = {
  todo: EntryRow
  trips: EntryRow[]
  effective: number | null
  conflict: boolean
}

export function listTrips(filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(TRIP_KEY), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function listTodos(filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(TODO_KEY), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 列表页和明细都走这一个入口取趟次，两边读到的必然一致。
export function tripsOfTodo(todoCode: string): EntryRow[] {
  return listRows(TRIP_KEY).filter((row) => String(row['关联停水待办']) === todoCode)
}

function findTrip(id: number): { rows: EntryRow[]; index: number } {
  const rows = listRows(TRIP_KEY)
  return { rows, index: rows.findIndex((row) => Number(row.id) === id) }
}

function findTodo(code: string): { rows: EntryRow[]; index: number } {
  const rows = listRows(TODO_KEY)
  return { rows, index: rows.findIndex((row) => String(row['待办编号']) === code) }
}

// 越权打回：写明越在哪一项，调度员照着改。
function overstepMessage(verb: string, trip: EntryRow, district: string): string {
  return `${verb}被打回：越权项「所属片区」——趟次 ${String(trip['送水编号'])} 归属「${String(trip['所属片区'])}」，当前调度员是「${district}」，只能调度本片区的车`
}

// 已出车趟次整条只读，本片区也不能再改。
function readonlyMessage(verb: string, trip: EntryRow): string {
  return `${verb}被打回：趟次 ${String(trip['送水编号'])} 已出车，整条只读，本片区也不能再改`
}

export function createTrip(input: TripInput): ActionResult {
  const code = input.送水编号.trim()
  if (!code) {
    return { ok: false, message: '送水编号不能为空' }
  }
  const rows = listRows(TRIP_KEY)
  if (rows.some((row) => String(row['送水编号']) === code)) {
    return { ok: false, message: `送水编号「${code}」已登记过，同一送水编号不许登记两遍` }
  }
  if (!DISTRICTS.includes(input.所属片区)) {
    return { ok: false, message: `所属片区「${input.所属片区}」不在片区名录里` }
  }
  if (!input.送水点位.trim()) {
    return { ok: false, message: '送水点位不能为空' }
  }
  const amount = Number(input.送水量)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, message: '送水量要填大于 0 的数字（吨）' }
  }
  if (!input.到场时间.trim()) {
    return { ok: false, message: '到场时间不能为空' }
  }
  const todoCode = input.关联停水待办.trim()
  if (findTodo(todoCode).index < 0) {
    return { ok: false, message: `关联停水待办「${todoCode}」不存在，趟次必须挂在客服受理的待办上` }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const next: EntryRow[] = [
    ...rows,
    {
      id,
      status: '待派车',
      pending: true,
      abnormal: false,
      送水编号: code,
      车牌号: input.车牌号.trim(),
      所属片区: input.所属片区,
      送水点位: input.送水点位.trim(),
      送水量: amount,
      到场时间: input.到场时间.trim(),
      关联停水待办: todoCode,
    },
  ]
  saveMulti({ [TRIP_KEY]: next })
  return { ok: true, message: `趟次 ${code} 已登记，当前状态「待派车」` }
}

export function changePoint(id: number, newPoint: string, district: string): ActionResult {
  const { rows, index } = findTrip(id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的送水趟次` }
  }
  const trip = rows[index]
  if (String(trip.status) === DISPATCHED) {
    return { ok: false, message: readonlyMessage('改点位', trip) }
  }
  if (String(trip['所属片区']) !== district) {
    return { ok: false, message: overstepMessage('改点位', trip, district) }
  }
  const point = newPoint.trim()
  if (!point) {
    return { ok: false, message: '新送水点位不能为空' }
  }
  const next = [...rows]
  next[index] = { ...trip, 送水点位: point }
  saveMulti({ [TRIP_KEY]: next })
  return { ok: true, message: `趟次 ${String(trip['送水编号'])} 的送水点位已改为「${point}」` }
}

export function dispatchTrip(id: number, district: string): ActionResult {
  const { rows, index } = findTrip(id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的送水趟次` }
  }
  const trip = rows[index]
  if (String(trip.status) === DISPATCHED) {
    return { ok: false, message: `趟次 ${String(trip['送水编号'])} 已出车，不能重复派车` }
  }
  if (String(trip['所属片区']) !== district) {
    return { ok: false, message: overstepMessage('派车', trip, district) }
  }
  const todoCode = String(trip['关联停水待办'] ?? '')
  const todo = findTodo(todoCode)
  if (todo.index < 0) {
    return { ok: false, message: `关联停水待办「${todoCode}」不存在，修正后可重试派车` }
  }
  const todoRow = todo.rows[todo.index]
  if (String(todoRow.status) === '已送达') {
    return { ok: false, message: `停水待办 ${todoCode} 已办结，这趟车不用再派` }
  }
  // 先全部校验完再一次落库：趟次与待办要么一起改要么都不改，派车出错可以直接重试。
  const nextTrips = [...rows]
  nextTrips[index] = { ...trip, status: DISPATCHED, pending: false }
  const nextTodos = [...todo.rows]
  nextTodos[todo.index] = { ...todoRow, status: '送水中', pending: true }
  try {
    saveMulti({ [TRIP_KEY]: nextTrips, [TODO_KEY]: nextTodos })
  } catch {
    return { ok: false, message: '派车写入失败，数据未变更，请重试派车' }
  }
  return { ok: true, message: `趟次 ${String(trip['送水编号'])} 已出车，停水待办 ${todoCode} 转为「送水中」` }
}

export function recordVerification(id: number, amount: number): ActionResult {
  const rows = listRows(TODO_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的停水待办` }
  }
  const todo = rows[index]
  if (String(todo.status) === '待派车') {
    return { ok: false, message: `待办 ${String(todo['待办编号'])} 还没派车，不能登记现场核量` }
  }
  if (String(todo.status) === '已送达') {
    return { ok: false, message: `待办 ${String(todo['待办编号'])} 已办结，不用重复核量` }
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, message: '现场核量要填大于 0 的数字（吨）' }
  }
  const next = [...rows]
  next[index] = { ...todo, 现场核量: amount, status: '已送达', pending: false }
  saveMulti({ [TODO_KEY]: next })
  return { ok: true, message: `待办 ${String(todo['待办编号'])} 现场核量 ${amount} 吨已登记，以核量为准办结` }
}

// 送水量与用户报缺口打架时，以现场核量的那版为准；还没核量就先按趟次送水量展示。
export function effectiveAmount(todo: EntryRow): number | null {
  const verified = Number(todo['现场核量'])
  if (Number.isFinite(verified) && verified > 0) {
    return verified
  }
  const trips = tripsOfTodo(String(todo['待办编号']))
  if (trips.length === 0) {
    return null
  }
  const amount = Number(trips[trips.length - 1]['送水量'])
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

export function hasAmountConflict(todo: EntryRow): boolean {
  const reported = Number(todo['用户报缺口'])
  if (!Number.isFinite(reported) || reported <= 0) {
    return false
  }
  return tripsOfTodo(String(todo['待办编号'])).some((trip) => Number(trip['送水量']) !== reported)
}

export function todoDetail(id: number): TodoDetail | null {
  const todo = listRows(TODO_KEY).find((row) => Number(row.id) === id)
  if (!todo) {
    return null
  }
  return {
    todo,
    trips: tripsOfTodo(String(todo['待办编号'])),
    effective: effectiveAmount(todo),
    conflict: hasAmountConflict(todo),
  }
}
