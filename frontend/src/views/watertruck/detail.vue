<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>送水趟次明细</h2>
        <p class="page-desc">与台账列表共用同一份数据，列表页和明细页读到的趟次始终一致。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" :to="{ name: 'watertruck' }">返回台账</RouterLink>
      </div>
    </header>

    <TripDetail :trip-id="tripId" />

    <div v-if="trip" class="detail-actions">
      <template v-if="trip.status === '待出车'">
        <template v-if="canOwn">
          <button class="btn primary" type="button" @click="depart">确认出车（出车后整条只读）</button>
          <RouterLink class="btn" :to="{ name: 'watertruck' }">回列表改派车项</RouterLink>
        </template>
        <span v-else class="muted">归 {{ store.districtName(trip.district) }} 调度，本片区不可操作。</span>
      </template>
      <template v-else-if="trip.status === '已出车'">
        <button v-if="trip.measuredTons == null" class="btn primary" type="button" @click="openArrival">登记到场时间与现场核量</button>
        <button v-else class="btn" type="button" @click="complete">办理归队</button>
      </template>
      <template v-else>
        <span class="muted">趟次已完成，台账归档只读。</span>
      </template>
    </div>

    <p v-if="message" class="page-foot" :class="ok ? 'ok-text' : 'error-text'">{{ message }}</p>

    <AppModal v-if="arrivalOpen && trip" :title="`现场到场核量 · ${trip.code}`" @close="arrivalOpen = false">
      <div class="form-grid one">
        <label class="field">
          <span>实际到场时间 *</span>
          <input v-model="arrivalAt" placeholder="2026-10-07 11:48" />
        </label>
        <label class="field">
          <span>现场核量（吨）*</span>
          <input v-model.number="measuredTons" type="number" min="0" step="0.5" />
        </label>
      </div>
      <template #footer>
        <button class="btn" type="button" @click="arrivalOpen = false">取消</button>
        <button class="btn primary" type="button" @click="submitArrival">提交核量</button>
      </template>
    </AppModal>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import AppModal from '@/components/AppModal.vue'
import TripDetail from '@/components/TripDetail.vue'
import { actingDispatcher, useWatertruckStore } from '@/stores/watertruck'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const tripId = Number(route.params.id)

const store = useWatertruckStore()
const session = useSessionStore()
store.hydrate()

const trip = computed(() => store.trips.find((t) => t.id === tripId))
const canOwn = computed(() => trip.value?.district === session.district)

const message = ref('')
const ok = ref(false)
function flash(text: string, isOk = false) {
  message.value = text
  ok.value = isOk
}

function depart() {
  const result = store.markDeparted(tripId, actingDispatcher(session.district))
  flash(result.message, result.ok)
}

const arrivalOpen = ref(false)
const arrivalAt = ref('')
const measuredTons = ref(0)
function openArrival() {
  arrivalAt.value = ''
  measuredTons.value = 0
  arrivalOpen.value = true
}
function submitArrival() {
  if (!arrivalAt.value || measuredTons.value <= 0) {
    flash('请填写实际到场时间与现场核量')
    return
  }
  const result = store.recordArrival(tripId, arrivalAt.value, measuredTons.value)
  flash(result.message, result.ok)
  if (result.ok) arrivalOpen.value = false
}
function complete() {
  const result = store.completeTrip(tripId)
  flash(result.message, result.ok)
}
</script>
