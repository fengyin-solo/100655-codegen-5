<template>
  <section class="page" data-module="watertruck">
    <header class="page-head">
      <div>
        <h2>应急送水车调度台账</h2>
        <p class="page-desc">
          一辆车一趟送水，挂送水编号、送水点位、送水量与到场时间。按片区派车：只有本片区调度员能派车与改点位，
          跨片区派车单越权打回并写明越在哪一项；已出车趟次整条只读。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记派车单</button>
        <button class="btn ghost" type="button" @click="confirmReset">重置示例数据</button>
      </div>
    </header>

    <div class="scope-bar">
      <span class="scope-tag">当前登录：{{ session.dispatcherTitle }}（{{ session.operator }}）</span>
      <span class="muted small">只可对 {{ store.districtName(session.district) }} 的点位与车辆派车</span>
      <label class="scope-check">
        <input v-model="showAllDistricts" type="checkbox" />
        查看全部片区（只读比对）
      </label>
    </div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待出车趟次</span>
        <strong class="stat-value">{{ countByStatus('待出车') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已出车（只读）</span>
        <strong class="stat-value">{{ countByStatus('已出车') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已完成</span>
        <strong class="stat-value">{{ countByStatus('已完成') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待审核/越权打回派车单</span>
        <strong class="stat-value">{{ pendingOrders.length }}</strong>
      </article>
    </div>

    <!-- 派车单受理箱 -->
    <section class="block">
      <h3 class="block-title">派车单受理箱</h3>
      <p class="muted small">别的片区递上来的单也进这里；受理时判定越权，打回会逐项写明越在哪一项，可改单后重试。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>派车单号</th><th>递单片区</th><th>送水点位</th><th>车辆</th>
            <th>送水编号</th><th>送水量</th><th>预计到场</th><th>状态</th><th>越权项 / 说明</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="order in scopedOrders" :key="order.id" :class="{ 'row-rejected': order.status === '已打回' }">
            <td>{{ order.code }}</td>
            <td>{{ store.districtName(order.fromDistrict) }} · {{ order.applicant }}</td>
            <td>{{ store.pointName(order.pointId) }}</td>
            <td>{{ store.truckPlate(order.truckId) }}</td>
            <td>{{ order.tripCode }}</td>
            <td>{{ order.tons }} 吨</td>
            <td>{{ order.eta }}</td>
            <td>
              <span class="pill" :class="orderPillClass(order.status)">{{ order.status }}</span>
            </td>
            <td class="reject-cell">
              <template v-if="order.rejectItems.length">
                <span v-for="item in order.rejectItems" :key="item" class="tag warn">越权·{{ item }}</span>
                <p class="small bad">{{ order.rejectReason }}</p>
              </template>
              <template v-else-if="order.status === '待审核'">
                <span class="muted small">待 {{ session.operator }} 受理</span>
              </template>
              <template v-else-if="order.tripId">
                <RouterLink class="link" :to="{ name: 'watertruck-trip', params: { id: order.tripId } }">已生成趟次</RouterLink>
              </template>
            </td>
            <td class="row-actions">
              <button v-if="order.status !== '已派车'" class="link" type="button" @click="accept(order.id)">受理派车</button>
              <button v-if="order.status !== '已派车'" class="link" type="button" @click="openRevise(order.id)">改单重试</button>
            </td>
          </tr>
          <tr v-if="!scopedOrders.length">
            <td colspan="10" class="empty-state">暂无待处理派车单</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 趟次台账 -->
    <section class="block">
      <h3 class="block-title">送水趟次台账</h3>
      <div class="filter-bar">
        <label class="filter-item">
          <span>趟次状态</span>
          <select v-model="statusFilter">
            <option value="">全部</option>
            <option v-for="s in tripStatuses" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>按送水编号 / 点位检索</span>
          <input v-model="keyword" placeholder="送水编号或点位" />
        </label>
        <button class="btn ghost" type="button" @click="statusFilter = ''; keyword = ''">清空条件</button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>送水编号</th><th>归属片区</th><th>送水点位</th><th>送水车辆</th>
            <th>送水量(派车/核量)</th><th>到场时间(预计/实际)</th><th>状态</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="trip in filteredTrips" :key="trip.id" :class="{ 'row-locked': store.isLocked(trip) }">
            <td>{{ trip.code }}</td>
            <td>{{ store.districtName(trip.district) }}</td>
            <td>{{ store.pointName(trip.pointId) }}</td>
            <td>{{ store.truckPlate(trip.truckId) }}</td>
            <td>
              {{ trip.plannedTons }} 吨
              <template v-if="trip.measuredTons != null">
                / <strong :class="trip.measuredTons >= trip.plannedTons ? 'ok' : 'bad'">{{ trip.measuredTons }} 吨核量</strong>
              </template>
            </td>
            <td>
              {{ trip.eta }}
              <template v-if="trip.arrivedAt">/ {{ trip.arrivedAt }}</template>
            </td>
            <td><span class="pill" :class="tripPillClass(trip.status)">{{ trip.status }}</span></td>
            <td class="row-actions">
              <RouterLink class="link" :to="{ name: 'watertruck-trip', params: { id: trip.id } }">明细</RouterLink>
              <template v-if="trip.status === '待出车'">
                <button v-if="canOwn(trip.district)" class="link" type="button" @click="openEdit(trip.id)">改派车项</button>
                <button v-if="canOwn(trip.district)" class="link" type="button" @click="depart(trip.id)">确认出车</button>
                <span v-else class="muted small">跨片区只读</span>
              </template>
              <template v-else-if="trip.status === '已出车'">
                <button v-if="trip.measuredTons == null" class="link" type="button" @click="openArrival(trip.id)">到场核量</button>
                <button v-if="trip.measuredTons != null" class="link" type="button" @click="complete(trip.id)">办理归队</button>
              </template>
              <template v-else><span class="muted small">整条只读</span></template>
            </td>
          </tr>
          <tr v-if="!filteredTrips.length">
            <td colspan="8" class="empty-state">暂无趟次记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <p v-if="message.text" class="page-foot" :class="message.ok ? 'ok-text' : 'error-text'">{{ message.text }}</p>

    <!-- 登记派车单 -->
    <AppModal v-if="createOpen" title="登记派车单" wide @close="createOpen = false">
      <div class="form-grid">
        <label class="field">
          <span>关联停水待办</span>
          <select v-model="form.todoId" @change="applyTodo">
            <option :value="undefined">不关联（直接指定点位）</option>
            <option v-for="t in pendingTodos" :key="t.id" :value="t.id">
              {{ t.code }} · {{ t.location }} · 报缺 {{ t.gapTons }} 吨
            </option>
          </select>
        </label>
        <label class="field">
          <span>送水点位 *</span>
          <select v-model="form.pointId">
            <option v-for="p in POINTS" :key="p.id" :value="p.id">
              {{ p.name }}（{{ store.districtName(p.district) }}）
            </option>
          </select>
        </label>
        <label class="field">
          <span>送水车辆 *</span>
          <select v-model="form.truckId">
            <option v-for="tr in TRUCKS" :key="tr.id" :value="tr.id">
              {{ tr.plate }}（{{ store.districtName(tr.district) }} · 载 {{ tr.capacityTons }} 吨）
            </option>
          </select>
        </label>
        <label class="field">
          <span>送水编号 *（全局唯一）</span>
          <input v-model="form.tripCode" placeholder="如 SS-20261007-05" />
        </label>
        <label class="field">
          <span>送水量（吨）*</span>
          <input v-model.number="form.tons" type="number" min="0" step="0.5" />
        </label>
        <label class="field">
          <span>预计到场时间 *</span>
          <input v-model="form.eta" placeholder="2026-10-07 12:00" />
        </label>
      </div>
      <p class="muted small">
        递单片区：{{ store.districtName(session.district) }} · {{ session.operator }}。
        若点位/车辆不归本片区，受理将按越权打回。
      </p>
      <template #footer>
        <button class="btn" type="button" @click="createOpen = false">取消</button>
        <button class="btn primary" type="button" @click="submitCreate">提交并受理</button>
      </template>
    </AppModal>

    <!-- 改单重试 -->
    <AppModal v-if="reviseId != null" :title="`改单重试 · ${reviseOrder?.code ?? ''}`" wide @close="reviseId = null">
      <div v-if="reviseOrder" class="form-grid">
        <label class="field">
          <span>送水点位 *</span>
          <select v-model="reviseForm.pointId">
            <option v-for="p in POINTS" :key="p.id" :value="p.id">
              {{ p.name }}（{{ store.districtName(p.district) }}）
            </option>
          </select>
        </label>
        <label class="field">
          <span>送水车辆 *</span>
          <select v-model="reviseForm.truckId">
            <option v-for="tr in TRUCKS" :key="tr.id" :value="tr.id">
              {{ tr.plate }}（{{ store.districtName(tr.district) }}）
            </option>
          </select>
        </label>
        <label class="field">
          <span>送水编号 *</span>
          <input v-model="reviseForm.tripCode" />
        </label>
        <label class="field">
          <span>送水量（吨）*</span>
          <input v-model.number="reviseForm.tons" type="number" min="0" step="0.5" />
        </label>
        <label class="field">
          <span>预计到场时间 *</span>
          <input v-model="reviseForm.eta" />
        </label>
      </div>
      <p v-if="reviseOrder?.rejectItems.length" class="bad small">上次打回（越权项）：{{ reviseOrder.rejectItems.join('、') }}。请改到本片区点位/车辆后重试。</p>
      <template #footer>
        <button class="btn" type="button" @click="reviseId = null">取消</button>
        <button class="btn primary" type="button" @click="submitRevise">改好并重新受理</button>
      </template>
    </AppModal>

    <!-- 改待出车趟次的派车项 -->
    <AppModal v-if="editId != null" :title="`改派车项 · ${editTrip?.code ?? ''}`" wide @close="editId = null">
      <div v-if="editTrip" class="form-grid">
        <label class="field">
          <span>送水编号（唯一）</span>
          <input v-model="editForm.code" />
        </label>
        <label class="field">
          <span>送水点位（仅本片区）</span>
          <select v-model="editForm.pointId">
            <option v-for="p in ownPoints" :key="p.id" :value="p.id">{{ p.name }}（{{ p.address }}）</option>
          </select>
        </label>
        <label class="field">
          <span>送水车辆（仅本片区）</span>
          <select v-model="editForm.truckId">
            <option v-for="tr in ownTrucks" :key="tr.id" :value="tr.id">
              {{ tr.plate }}（载 {{ tr.capacityTons }} 吨）
            </option>
          </select>
        </label>
        <label class="field">
          <span>送水量（吨）</span>
          <input v-model.number="editForm.plannedTons" type="number" min="0" step="0.5" />
        </label>
        <label class="field">
          <span>预计到场时间</span>
          <input v-model="editForm.eta" />
        </label>
      </div>
      <p class="muted small">出车前可改；一旦确认出车，整条只读。跨片区改点位会按越权拒绝。</p>
      <template #footer>
        <button class="btn" type="button" @click="editId = null">取消</button>
        <button class="btn primary" type="button" @click="submitEdit">保存改动</button>
      </template>
    </AppModal>

    <!-- 到场核量 -->
    <AppModal v-if="arrivalId != null" :title="`现场到场核量 · ${arrivalTrip?.code ?? ''}`" @close="arrivalId = null">
      <p class="muted small">出车后一次性回填送达凭据；不改派车台账列。现场核量与用户报缺打架时，以现场核量为准。</p>
      <div class="form-grid one">
        <label class="field">
          <span>实际到场时间 *</span>
          <input v-model="arrivalForm.arrivedAt" placeholder="2026-10-07 11:48" />
        </label>
        <label class="field">
          <span>现场核量（吨）*</span>
          <input v-model.number="arrivalForm.measuredTons" type="number" min="0" step="0.5" />
        </label>
      </div>
      <template #footer>
        <button class="btn" type="button" @click="arrivalId = null">取消</button>
        <button class="btn primary" type="button" @click="submitArrival">提交核量</button>
      </template>
    </AppModal>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'

import AppModal from '@/components/AppModal.vue'
import { POINTS, TRUCKS } from '@/data/watertruck'
import type { DispatchOrder, DistrictCode, OrderDraft, Trip, TripStatus } from '@/data/watertruck'
import { actingDispatcher, useWatertruckStore } from '@/stores/watertruck'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const store = useWatertruckStore()
const session = useSessionStore()
store.hydrate()

const tripStatuses: TripStatus[] = ['待出车', '已出车', '已完成']
const statusFilter = ref<'' | TripStatus>('')
const keyword = ref('')
const showAllDistricts = ref(false)
const message = reactive({ text: '', ok: false })

function flash(text: string, ok = false) {
  message.text = text
  message.ok = ok
}

const actor = computed(() => actingDispatcher(session.district))
const canOwn = (district: DistrictCode) => district === session.district

// ---------- 趟次列表 ----------

const scopedTrips = computed(() =>
  showAllDistricts.value ? store.trips : store.trips.filter((t) => t.district === session.district),
)
const filteredTrips = computed(() =>
  scopedTrips.value.filter((t) => {
    if (statusFilter.value && t.status !== statusFilter.value) return false
    if (keyword.value.trim()) {
      const k = keyword.value.trim()
      return t.code.includes(k) || store.pointName(t.pointId).includes(k)
    }
    return true
  }),
)
function countByStatus(status: TripStatus) {
  return scopedTrips.value.filter((t) => t.status === status).length
}

// ---------- 派车单 ----------

const scopedOrders = computed(() =>
  store.orders.filter(
    (o) => showAllDistricts.value || POINTS.find((p) => p.id === o.pointId)?.district === session.district,
  ),
)
const pendingOrders = computed(() =>
  store.orders.filter((o) => o.status !== '已派车' && POINTS.find((p) => p.id === o.pointId)?.district === session.district),
)
const pendingTodos = computed(() => store.todos.filter((t) => t.status === '待派车'))

function accept(orderId: number) {
  const result = store.dispatchOrder(orderId, actor.value)
  flash(result.message, result.ok)
}

// ---------- 新建派车单 ----------

const createOpen = ref(false)
const form = reactive<OrderDraft & { todoId?: number }>({
  pointId: '', truckId: '', tripCode: '', tons: 0, eta: '', todoId: undefined,
})

function suggestCode(): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const max = store.trips.reduce((m, t) => {
    const mm = t.code.match(/(\d+)$/)
    return Math.max(m, mm ? Number(mm[1]) : 0)
  }, 0)
  return `SS-${day}-${String(max + 1).padStart(2, '0')}`
}

function openCreate() {
  Object.assign(form, { pointId: '', truckId: '', tripCode: suggestCode(), tons: 0, eta: '', todoId: undefined })
  createOpen.value = true
}

function applyTodo() {
  if (form.todoId == null) return
  const todo = store.todos.find((t) => t.id === form.todoId)
  if (!todo) return
  if (todo.pointId) form.pointId = todo.pointId
  form.tons = todo.gapTons
  const ownTruck = TRUCKS.find((t) => t.district === todo.district)
  if (ownTruck) form.truckId = ownTruck.id
}

function submitCreate() {
  if (!form.pointId || !form.truckId || !form.tripCode.trim() || !form.tons || !form.eta) {
    flash('请把派车单的点位、车辆、编号、水量、到场时间填完整')
    return
  }
  const order = store.submitOrderDraft({ ...form }, actor.value)
  const result = store.dispatchOrder(order.id, actor.value)
  flash(result.message, result.ok)
  if (result.ok) createOpen.value = false
}

// 从客服待办「去派车」带 todo 跳来：自动打开并预填这张报缺。
onMounted(() => {
  const q = route.query.todo
  if (q == null) return
  const todoId = Number(Array.isArray(q) ? q[0] : q)
  if (store.todos.some((t) => t.id === todoId)) {
    openCreate()
    form.todoId = todoId
    applyTodo()
  }
})

// ---------- 改单重试 ----------

const reviseId = ref<number | null>(null)
const reviseForm = reactive<OrderDraft>({ pointId: '', truckId: '', tripCode: '', tons: 0, eta: '' })
const reviseOrder = computed(() => store.orders.find((o) => o.id === reviseId.value))

function openRevise(orderId: number) {
  const order = store.orders.find((o) => o.id === orderId)
  if (!order) return
  reviseId.value = orderId
  Object.assign(reviseForm, {
    pointId: order.pointId,
    truckId: order.truckId,
    tripCode: order.tripCode,
    tons: order.tons,
    eta: order.eta,
  })
}

function submitRevise() {
  if (reviseId.value == null) return
  store.reviseOrder(reviseId.value, { ...reviseForm })
  const result = store.dispatchOrder(reviseId.value, actor.value)
  flash(result.message, result.ok)
  if (result.ok) reviseId.value = null
}

// ---------- 改趟次 ----------

const editId = ref<number | null>(null)
const editForm = reactive({ code: '', pointId: '', truckId: '', plannedTons: 0, eta: '' })
const editTrip = computed(() => store.trips.find((t) => t.id === editId.value))
const ownPoints = computed(() => POINTS.filter((p) => p.district === session.district))
const ownTrucks = computed(() => TRUCKS.filter((t) => t.district === session.district))

function openEdit(tripId: number) {
  const trip = store.trips.find((t) => t.id === tripId)
  if (!trip) return
  editId.value = tripId
  Object.assign(editForm, {
    code: trip.code,
    pointId: trip.pointId,
    truckId: trip.truckId,
    plannedTons: trip.plannedTons,
    eta: trip.eta,
  })
}

function submitEdit() {
  if (editId.value == null) return
  const result = store.updateTrip(editId.value, actor.value, { ...editForm })
  flash(result.message, result.ok)
  if (result.ok) editId.value = null
}

// ---------- 出车 / 到场核量 / 归队 ----------

function depart(tripId: number) {
  const result = store.markDeparted(tripId, actor.value)
  flash(result.message, result.ok)
}

const arrivalId = ref<number | null>(null)
const arrivalForm = reactive({ arrivedAt: '', measuredTons: 0 })
const arrivalTrip = computed(() => store.trips.find((t) => t.id === arrivalId.value))

function openArrival(tripId: number) {
  arrivalId.value = tripId
  Object.assign(arrivalForm, { arrivedAt: '', measuredTons: 0 })
}

function submitArrival() {
  if (arrivalId.value == null) return
  if (!arrivalForm.arrivedAt || arrivalForm.measuredTons <= 0) {
    flash('请填写实际到场时间与现场核量')
    return
  }
  const result = store.recordArrival(arrivalId.value, arrivalForm.arrivedAt, arrivalForm.measuredTons)
  flash(result.message, result.ok)
  if (result.ok) arrivalId.value = null
}

function complete(tripId: number) {
  const result = store.completeTrip(tripId)
  flash(result.message, result.ok)
}

// ---------- 样式辅助 / 重置 ----------

function orderPillClass(status: DispatchOrder['status']) {
  return { 'pill-open': status === '待审核', 'pill-warn': status === '已打回', 'pill-done': status === '已派车' }
}
function tripPillClass(status: Trip['status']) {
  return { 'pill-open': status === '待出车', 'pill-warn': status === '已出车', 'pill-done': status === '已完成' }
}

function confirmReset() {
  if (window.confirm('确定清空本地改动，恢复示例数据？')) {
    store.resetAll()
    flash('已恢复示例数据', true)
  }
}
</script>
