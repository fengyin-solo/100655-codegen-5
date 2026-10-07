<template>
  <section class="page" data-module="outage">
    <header class="page-head">
      <div>
        <h2>客服受理 · 停水待办</h2>
        <p class="page-desc">
          受理用户报缺并跟进送水。派车动作会直接反映到这里：待办状态、关联趟次、送水量均与调度台账同源，
          列表页与明细页读到的趟次一致；现场核量与报缺打架时以现场核量为准。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记停水报缺</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待派车</span>
        <strong class="stat-value">{{ countBy('待派车') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已派车（待送达）</span>
        <strong class="stat-value">{{ countBy('已派车') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已送水</span>
        <strong class="stat-value">{{ countBy('已送水') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">现场核量不足</span>
        <strong class="stat-value bad">{{ underSupplied }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent>
      <label class="filter-item">
        <span>状态</span>
        <select v-model="statusFilter">
          <option value="">全部</option>
          <option value="待派车">待派车</option>
          <option value="已派车">已派车</option>
          <option value="已送水">已送水</option>
        </select>
      </label>
      <label class="filter-item">
        <span>片区</span>
        <select v-model="districtFilter">
          <option value="">全部片区</option>
          <option v-for="d in DISTRICTS" :key="d.code" :value="d.code">{{ d.name }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>检索</span>
        <input v-model="keyword" placeholder="待办编号 / 停水位置" />
      </label>
      <button class="btn ghost" type="button" @click="statusFilter=''; districtFilter=''; keyword=''">清空条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>待办编号</th><th>片区</th><th>停水位置</th><th>报缺量</th><th>影响户数</th>
          <th>受理时间</th><th>状态</th><th>派车送水量</th><th>现场核量(有效)</th><th>对账</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="view in filtered" :key="view.todo.id">
          <td>{{ view.todo.code }}</td>
          <td>{{ store.districtName(view.todo.district) }}</td>
          <td>{{ view.todo.location }}</td>
          <td>{{ view.todo.gapTons }} 吨</td>
          <td>{{ view.todo.households }}</td>
          <td>{{ view.todo.receivedAt }}</td>
          <td><span class="pill" :class="todoPillClass(view.todo.status)">{{ view.todo.status }}</span></td>
          <td>{{ view.trip ? view.trip.plannedTons + ' 吨' : '—' }}</td>
          <td>
            <template v-if="view.effectiveTons != null">
              <strong>{{ view.effectiveTons }} 吨</strong>
              <span v-if="view.trip && view.trip.measuredTons != null" class="tag note">现场版</span>
            </template>
            <template v-else>—</template>
          </td>
          <td>
            <span class="tag" :class="reconcileTagClass(view.reconcile)">{{ reconcileText(view.reconcile) }}</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="detailId = view.todo.id">明细</button>
            <RouterLink
              v-if="view.todo.status !== '待派车' && view.trip"
              class="link"
              :to="{ name: 'watertruck-trip', params: { id: view.trip.id } }"
            >看趟次</RouterLink>
            <RouterLink v-else class="link" :to="{ name: 'watertruck', query: { todo: view.todo.id } }">去派车</RouterLink>
          </td>
        </tr>
        <tr v-if="!filtered.length">
          <td colspan="11" class="empty-state">暂无匹配的停水待办</td>
        </tr>
      </tbody>
    </table>

    <!-- 明细：与列表同一份派生读数 -->
    <AppModal v-if="detail" :title="`停水待办明细 · ${detail.todo.code}`" wide @close="detailId = null">
      <dl class="detail-grid">
        <div><dt>停水位置</dt><dd>{{ detail.todo.location }}</dd></div>
        <div><dt>归属片区</dt><dd>{{ store.districtName(detail.todo.district) }}</dd></div>
        <div><dt>联系人</dt><dd>{{ detail.todo.contact }} {{ detail.todo.phone }}</dd></div>
        <div><dt>影响户数</dt><dd>{{ detail.todo.households }} 户</dd></div>
        <div><dt>用户报缺</dt><dd>{{ detail.todo.gapTons }} 吨</dd></div>
        <div><dt>受理时间</dt><dd>{{ detail.todo.receivedAt }}</dd></div>
        <div><dt>当前状态</dt><dd>{{ detail.todo.status }}</dd></div>
        <div><dt>有效送水量</dt><dd>{{ detail.effectiveTons != null ? detail.effectiveTons + ' 吨' : '尚未派车' }}</dd></div>
      </dl>

      <div v-if="detail.trip" class="linked-trip">
        <h4>关联送水趟次（调度台账同源）</h4>
        <TripDetail :trip-id="detail.trip.id" />
      </div>
      <p v-else class="muted">尚未派车，可前往调度台账登记派车单。</p>

      <template #footer>
        <RouterLink class="btn" :to="{ name: 'watertruck' }">去调度台账</RouterLink>
      </template>
    </AppModal>

    <!-- 登记报缺 -->
    <AppModal v-if="createOpen" title="登记停水报缺" wide @close="createOpen = false">
      <div class="form-grid">
        <label class="field">
          <span>归属片区 *</span>
          <select v-model="draft.district" @change="draft.pointId = ''">
            <option v-for="d in DISTRICTS" :key="d.code" :value="d.code">{{ d.name }}</option>
          </select>
        </label>
        <label class="field">
          <span>送水点位（可关联建档点位）</span>
          <select v-model="draft.pointId">
            <option value="">临时点位 / 无</option>
            <option v-for="p in districtPoints" :key="p.id" :value="p.id">{{ p.name }}（{{ p.address }}）</option>
          </select>
        </label>
        <label class="field">
          <span>停水位置 *</span>
          <input v-model="draft.location" placeholder="如 城东花园小区" />
        </label>
        <label class="field">
          <span>联系人</span>
          <input v-model="draft.contact" />
        </label>
        <label class="field">
          <span>联系电话</span>
          <input v-model="draft.phone" />
        </label>
        <label class="field">
          <span>用户报缺量（吨）*</span>
          <input v-model.number="draft.gapTons" type="number" min="0" step="0.5" />
        </label>
        <label class="field">
          <span>影响户数</span>
          <input v-model.number="draft.households" type="number" min="0" />
        </label>
      </div>
      <template #footer>
        <button class="btn" type="button" @click="createOpen = false">取消</button>
        <button class="btn primary" type="button" @click="submitCreate">受理登记</button>
      </template>
    </AppModal>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import AppModal from '@/components/AppModal.vue'
import TripDetail from '@/components/TripDetail.vue'
import { DISTRICTS, POINTS } from '@/data/watertruck'
import type { DistrictCode, TodoDraft, TodoStatus } from '@/data/watertruck'
import { useWatertruckStore } from '@/stores/watertruck'

const store = useWatertruckStore()
store.hydrate()

const statusFilter = ref<'' | TodoStatus>('')
const districtFilter = ref<'' | DistrictCode>('')
const keyword = ref('')
const detailId = ref<number | null>(null)
const createOpen = ref(false)

const views = computed(() => store.todoViews)
const filtered = computed(() =>
  views.value.filter((v) => {
    if (statusFilter.value && v.todo.status !== statusFilter.value) return false
    if (districtFilter.value && v.todo.district !== districtFilter.value) return false
    if (keyword.value.trim()) {
      const k = keyword.value.trim()
      return v.todo.code.includes(k) || v.todo.location.includes(k)
    }
    return true
  }),
)
const detail = computed(() => views.value.find((v) => v.todo.id === detailId.value))

function countBy(status: TodoStatus) {
  return views.value.filter((v) => v.todo.status === status).length
}
const underSupplied = computed(() => views.value.filter((v) => v.reconcile === '不足').length)

function reconcileText(r: string) {
  return { 未派车: '未派车', 待核量: '已派车·待核量', 足量: '足额送达', 不足: '核量不足', 超量: '超量送达' }[r] ?? r
}
function reconcileTagClass(r: string) {
  if (r === '足量' || r === '超量') return 'ok'
  if (r === '不足') return 'warn'
  if (r === '待核量') return 'note'
  return 'muted'
}
function todoPillClass(status: TodoStatus) {
  return { 'pill-open': status === '待派车', 'pill-warn': status === '已派车', 'pill-done': status === '已送水' }
}

// ---------- 登记报缺 ----------

const emptyDraft = (): TodoDraft => ({
  district: 'east', pointId: '', location: '', contact: '', phone: '', gapTons: 0, households: 0,
  receivedAt: '',
})
const draft = reactive<TodoDraft>(emptyDraft())
const districtPoints = computed(() => POINTS.filter((p) => p.district === draft.district))

function openCreate() {
  Object.assign(draft, emptyDraft())
  createOpen.value = true
}

function submitCreate() {
  if (!draft.location.trim() || draft.gapTons <= 0) {
    window.alert('请至少填写停水位置与用户报缺量')
    return
  }
  if (draft.pointId) {
    const point = POINTS.find((p) => p.id === draft.pointId)
    if (point) draft.location = point.name
  }
  store.addTodo({ ...draft })
  createOpen.value = false
}
</script>
