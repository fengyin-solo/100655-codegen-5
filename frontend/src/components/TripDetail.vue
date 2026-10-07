<template>
  <div v-if="trip" class="trip-detail">
    <div class="detail-banner" :class="bannerClass">
      <span>趟次状态：{{ trip.status }}</span>
      <span v-if="locked">已出车后整条只读，本片区也不能再改</span>
      <span v-else>待出车：仅 {{ store.districtName(trip.district) }} 可派车/改点位</span>
    </div>

    <dl class="detail-grid">
      <div><dt>送水编号</dt><dd>{{ trip.code }}</dd></div>
      <div><dt>归属片区</dt><dd>{{ store.districtName(trip.district) }}</dd></div>
      <div><dt>送水点位</dt><dd>{{ store.pointName(trip.pointId) }}</dd></div>
      <div><dt>送水车辆</dt><dd>{{ store.truckPlate(trip.truckId) }}</dd></div>
      <div><dt>派车送水量</dt><dd>{{ trip.plannedTons }} 吨</dd></div>
      <div><dt>预计到场时间</dt><dd>{{ trip.eta }}</dd></div>
      <div><dt>实际到场时间</dt><dd>{{ trip.arrivedAt || '尚未回填' }}</dd></div>
      <div>
        <dt>现场核量</dt>
        <dd>
          <template v-if="trip.measuredTons != null">{{ trip.measuredTons }} 吨（以现场核量为准）</template>
          <template v-else>待现场核量</template>
        </dd>
      </div>
      <div><dt>派车调度员</dt><dd>{{ store.districtName(trip.dispatcherDistrict) }} · {{ trip.dispatcher }}</dd></div>
      <div><dt>派车时间</dt><dd>{{ trip.dispatchedAt }}</dd></div>
    </dl>

    <div v-if="todo" class="detail-reconcile">
      <h4>与用户报缺对账</h4>
      <p>
        用户报缺 <strong>{{ todo.gapTons }}</strong> 吨；
        <template v-if="trip.measuredTons != null">
          现场核量 <strong>{{ trip.measuredTons }}</strong> 吨，
          <em :class="reconcileClass">{{ reconcileText }}</em>
        </template>
        <template v-else>
          派车 {{ trip.plannedTons }} 吨，<em class="muted">尚未现场核量，暂按派车量对账</em>
        </template>
      </p>
      <p class="muted small">关联停水待办：{{ todo.code }} · {{ todo.location }} · {{ todo.households }} 户</p>
    </div>
  </div>
  <p v-else class="empty-state">没有找到这趟送水记录</p>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useWatertruckStore } from '@/stores/watertruck'

const props = defineProps<{ tripId: number }>()

const store = useWatertruckStore()
store.hydrate()

const trip = computed(() => store.trips.find((t) => t.id === props.tripId))
const todo = computed(() =>
  trip.value?.todoId != null ? store.todos.find((t) => t.id === trip.value!.todoId) : undefined,
)
const locked = computed(() => (trip.value ? store.isLocked(trip.value) : false))

const bannerClass = computed(() => ({
  'is-locked': locked.value,
  'is-open': !locked.value,
}))

const reconcileText = computed(() => {
  if (!trip.value || !todo.value || trip.value.measuredTons == null) return ''
  const m = trip.value.measuredTons
  const gap = todo.value.gapTons
  if (m >= gap) return m > gap ? '超量送达' : '足额送达'
  return `仍缺 ${gap - m} 吨`
})
const reconcileClass = computed(() => {
  if (!trip.value || !todo.value || trip.value.measuredTons == null) return ''
  return trip.value.measuredTons >= todo.value.gapTons ? 'ok' : 'bad'
})
</script>
