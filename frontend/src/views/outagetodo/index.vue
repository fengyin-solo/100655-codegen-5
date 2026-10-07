<template>
  <section class="page" data-module="outagetodo">
    <header class="page-head">
      <div>
        <h2>客服停水待办</h2>
        <p class="page-desc">客服受理的停水待办，派车动作实时回写到这里；送水量与用户报缺口不一致时，以现场核量为准。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出待办清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <div v-if="errorMessage" class="banner error">
      <span>{{ errorMessage }}</span>
    </div>
    <div v-if="okMessage" class="banner ok">
      <span>{{ okMessage }}</span>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>有效送水量</th>
          <th>关联趟次</th>
          <th>当前状态</th>
          <th>明细</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="String(row.id)"
          :class="{ selected: selectedId === Number(row.id) }"
        >
          <td v-for="column in columns" :key="column">{{ cellText(row[column]) }}</td>
          <td>{{ effectiveText(row) }}</td>
          <td>{{ tripCodesText(row) }}</td>
          <td>{{ row.status }}</td>
          <td>
            <button class="link" type="button" @click="openDetail(row)">查看明细</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无停水待办</td>
        </tr>
      </tbody>
    </table>

    <section v-if="detail" class="panel">
      <h3 class="panel-title">待办明细：{{ detail.todo['待办编号'] }}</h3>
      <div class="detail-grid">
        <div>
          <span>报修片区</span>
          <strong>{{ detail.todo['报修片区'] }}</strong>
        </div>
        <div>
          <span>停水点位</span>
          <strong>{{ detail.todo['停水点位'] }}</strong>
        </div>
        <div>
          <span>用户报缺口（吨）</span>
          <strong>{{ detail.todo['用户报缺口'] }}</strong>
        </div>
        <div>
          <span>现场核量（吨）</span>
          <strong>{{ detail.todo['现场核量'] === '' ? '未登记' : detail.todo['现场核量'] }}</strong>
        </div>
        <div>
          <span>有效送水量（吨）</span>
          <strong>{{ detail.effective ?? '—' }}</strong>
        </div>
        <div>
          <span>受理客服 / 时间</span>
          <strong>{{ detail.todo['受理客服'] }} · {{ detail.todo['受理时间'] }}</strong>
        </div>
      </div>
      <p v-if="detail.conflict" class="hint">
        趟次送水量与用户报缺口不一致，以现场核量登记的那版为准。
      </p>

      <h3 class="panel-title">关联送水趟次（与列表页同源读取，两边一致）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>送水编号</th>
            <th>车牌号</th>
            <th>所属片区</th>
            <th>送水点位</th>
            <th>送水量</th>
            <th>到场时间</th>
            <th>当前状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="trip in detail.trips" :key="String(trip.id)">
            <td>{{ trip['送水编号'] }}</td>
            <td>{{ trip['车牌号'] }}</td>
            <td>{{ trip['所属片区'] }}</td>
            <td>{{ trip['送水点位'] }}</td>
            <td>{{ trip['送水量'] }}</td>
            <td>{{ trip['到场时间'] }}</td>
            <td>{{ trip.status }}</td>
          </tr>
          <tr v-if="!detail.trips.length">
            <td colspan="7" class="empty-state">还没有关联的送水趟次，请到应急送水车调度台账登记并派车</td>
          </tr>
        </tbody>
      </table>

      <form v-if="detail.todo.status === '送水中'" class="form-grid verify-bar" @submit.prevent="submitVerification">
        <label class="form-item">
          <span>现场核量（吨）</span>
          <input v-model="verifyAmount" type="number" min="0" step="0.5" placeholder="以现场核量为准" />
        </label>
        <button class="btn primary" type="submit">登记现场核量并办结</button>
      </form>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条停水待办</span>
      <span>有效送水量 = 现场核量优先，未核量时按趟次送水量展示</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  TODO_STATUSES,
  effectiveAmount,
  listTodos,
  recordVerification,
  todoDetail,
  tripsOfTodo,
} from '@/api/watertruck-service'
import type { TodoDetail } from '@/api/watertruck-service'
import type { EntryRow } from '@/data/types'

const columns = ['待办编号', '报修片区', '停水点位', '用户报缺口', '现场核量', '受理客服', '受理时间']
const filterFields = ['待办编号', '报修片区', '停水点位']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const filters = ref<Record<string, string>>({})
const errorMessage = ref('')
const okMessage = ref('')
const selectedId = ref<number | null>(null)
const detail = ref<TodoDetail | null>(null)
const verifyAmount = ref('')

const stats = computed(() => [
  { label: '待派车待办', value: rows.value.filter((row) => String(row.status) === '待派车').length },
  { label: '送水中待办', value: rows.value.filter((row) => String(row.status) === '送水中').length },
  { label: '已送达待办', value: rows.value.filter((row) => String(row.status) === '已送达').length },
])

const statusSummary = computed(() =>
  TODO_STATUSES.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function cellText(value: string | number | boolean | undefined): string | number {
  if (value === undefined || value === '') {
    return '—'
  }
  return typeof value === 'boolean' ? String(value) : value
}

// 列表与明细都经 effectiveAmount / tripsOfTodo 读同一份台账，看到的趟次与水量一致。
function effectiveText(row: EntryRow): string {
  const amount = effectiveAmount(row)
  return amount === null ? '—' : `${amount} 吨`
}

function tripCodesText(row: EntryRow): string {
  const codes = tripsOfTodo(String(row['待办编号'])).map((trip) => String(trip['送水编号']))
  return codes.length ? codes.join('、') : '—'
}

function clearMessages() {
  errorMessage.value = ''
  okMessage.value = ''
}

function openDetail(row: EntryRow) {
  clearMessages()
  selectedId.value = Number(row.id)
  detail.value = todoDetail(Number(row.id))
  verifyAmount.value = ''
}

function submitVerification() {
  if (!detail.value) {
    return
  }
  clearMessages()
  const result = recordVerification(Number(detail.value.todo.id), Number(verifyAmount.value))
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  okMessage.value = result.message
  reload()
  detail.value = todoDetail(Number(detail.value.todo.id))
}

function resetFilters() {
  filters.value = {}
  clearMessages()
  reload()
}

function exportRows() {
  downloadEntries('outagetodo')
}

function reload() {
  try {
    const payload = listTodos(filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '停水待办列表读取失败'
  }
}

onMounted(reload)
</script>
