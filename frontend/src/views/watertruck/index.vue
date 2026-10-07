<template>
  <section class="page" data-module="watertruck">
    <header class="page-head">
      <div>
        <h2>应急送水车调度台账</h2>
        <p class="page-desc">一辆车一趟送水，登记送水编号、送水点位、送水量与到场时间；按片区归属派车，已出车趟次整条只读。</p>
      </div>
      <div class="page-actions">
        <label class="district-picker">
          <span>当前调度片区</span>
          <select :value="store.district" @change="switchDistrict">
            <option v-for="item in DISTRICTS" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <button class="btn primary" type="button" @click="toggleCreate">登记送水趟次</button>
        <button class="btn" type="button" @click="exportRows">导出趟次清单</button>
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
      <button v-if="failedDispatchId !== null" class="btn ghost" type="button" @click="retryDispatch">
        重试派车
      </button>
    </div>
    <div v-if="okMessage" class="banner ok">
      <span>{{ okMessage }}</span>
    </div>

    <form v-if="creating" class="panel" @submit.prevent="submitCreate">
      <h3 class="panel-title">登记送水趟次（同一送水编号不许登记两遍）</h3>
      <div class="form-grid">
        <label class="form-item">
          <span>送水编号</span>
          <input v-model="form.送水编号" placeholder="如 WS-20261007-004" />
        </label>
        <label class="form-item">
          <span>车牌号</span>
          <input v-model="form.车牌号" placeholder="如 皖A·W1004" />
        </label>
        <label class="form-item">
          <span>所属片区</span>
          <select v-model="form.所属片区">
            <option v-for="item in DISTRICTS" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>送水点位</span>
          <input v-model="form.送水点位" placeholder="送水点位" />
        </label>
        <label class="form-item">
          <span>送水量（吨）</span>
          <input v-model="form.送水量" type="number" min="0" step="0.5" />
        </label>
        <label class="form-item">
          <span>到场时间</span>
          <input v-model="form.到场时间" type="datetime-local" />
        </label>
        <label class="form-item">
          <span>关联停水待办</span>
          <select v-model="form.关联停水待办">
            <option value="" disabled>选择客服受理的待办</option>
            <option v-for="todo in openTodos" :key="String(todo.id)" :value="String(todo['待办编号'])">
              {{ todo['待办编号'] }} · {{ todo['停水点位'] }}
            </option>
          </select>
        </label>
        <button class="btn primary" type="submit">提交登记</button>
        <button class="btn ghost" type="button" @click="toggleCreate">取消</button>
      </div>
    </form>

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
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <span v-if="isDispatched(row)" class="tag readonly">已出车·整条只读</span>
            <template v-else>
              <button class="link" type="button" @click="dispatch(row)">派车</button>
              <button class="link" type="button" @click="openPointEditor(row)">改点位</button>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无送水趟次，可先登记送水趟次</td>
        </tr>
      </tbody>
    </table>

    <div v-if="pointEditor.id !== null" class="panel">
      <h3 class="panel-title">改点位：{{ pointEditor.code }}（{{ pointEditor.district }}）</h3>
      <div class="form-grid">
        <label class="form-item">
          <span>新送水点位</span>
          <input v-model="pointEditor.point" placeholder="填写新的送水点位" />
        </label>
        <button class="btn primary" type="button" @click="submitPoint">确认改点位</button>
        <button class="btn ghost" type="button" @click="closePointEditor">取消</button>
      </div>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条送水趟次</span>
      <span>跨片区派车、改点位会被打回并写明越权项；已出车趟次本片区也不能再改</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  DISTRICTS,
  TRIP_STATUSES,
  changePoint,
  createTrip,
  dispatchTrip,
  listTodos,
  listTrips,
} from '@/api/watertruck-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const columns = ['送水编号', '车牌号', '所属片区', '送水点位', '送水量', '到场时间', '关联停水待办']
const filterFields = ['送水编号', '所属片区', '送水点位']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const filters = ref<Record<string, string>>({})
const errorMessage = ref('')
const okMessage = ref('')
// 派车出错时记下这趟车，错误条上给出重试入口。
const failedDispatchId = ref<number | null>(null)
const creating = ref(false)

const form = reactive({
  送水编号: '',
  车牌号: '',
  所属片区: store.district,
  送水点位: '',
  送水量: '',
  到场时间: '',
  关联停水待办: '',
})

const pointEditor = reactive({ id: null as number | null, code: '', district: '', point: '' })

const openTodos = computed(() =>
  listTodos().items.filter((row) => String(row.status) !== '已送达'),
)

const stats = computed(() => [
  { label: '待派车趟次', value: rows.value.filter((row) => String(row.status) === '待派车').length },
  { label: '已出车趟次', value: rows.value.filter((row) => String(row.status) === '已出车').length },
  {
    label: `本片区（${store.district}）趟次`,
    value: rows.value.filter((row) => String(row['所属片区']) === store.district).length,
  },
])

const statusSummary = computed(() =>
  TRIP_STATUSES.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isDispatched(row: EntryRow): boolean {
  return String(row.status) === '已出车'
}

function clearMessages() {
  errorMessage.value = ''
  okMessage.value = ''
}

function switchDistrict(event: Event) {
  store.setDistrict((event.target as HTMLSelectElement).value)
}

function toggleCreate() {
  creating.value = !creating.value
  if (creating.value) {
    form.所属片区 = store.district
  }
}

function submitCreate() {
  clearMessages()
  const result = createTrip({ ...form, 到场时间: form.到场时间.replace('T', ' ') })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  okMessage.value = result.message
  creating.value = false
  form.送水编号 = ''
  form.车牌号 = ''
  form.送水点位 = ''
  form.送水量 = ''
  form.到场时间 = ''
  form.关联停水待办 = ''
  reload()
}

function doDispatch(id: number) {
  clearMessages()
  const result = dispatchTrip(id, store.district)
  if (!result.ok) {
    errorMessage.value = result.message
    failedDispatchId.value = id
    return
  }
  failedDispatchId.value = null
  okMessage.value = result.message
  reload()
}

function dispatch(row: EntryRow) {
  doDispatch(Number(row.id))
}

function retryDispatch() {
  if (failedDispatchId.value !== null) {
    doDispatch(failedDispatchId.value)
  }
}

function openPointEditor(row: EntryRow) {
  clearMessages()
  pointEditor.id = Number(row.id)
  pointEditor.code = String(row['送水编号'])
  pointEditor.district = String(row['所属片区'])
  pointEditor.point = String(row['送水点位'])
}

function closePointEditor() {
  pointEditor.id = null
}

function submitPoint() {
  if (pointEditor.id === null) {
    return
  }
  clearMessages()
  const result = changePoint(pointEditor.id, pointEditor.point, store.district)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  okMessage.value = result.message
  closePointEditor()
  reload()
}

function resetFilters() {
  filters.value = {}
  clearMessages()
  failedDispatchId.value = null
  reload()
}

function exportRows() {
  downloadEntries('watertruck')
}

// reload 只负责重取数据，不清消息：动作的成功/失败提示要在刷新后仍然看得到。
function reload() {
  try {
    const payload = listTrips(filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '送水趟次列表读取失败'
  }
}

onMounted(reload)
</script>
