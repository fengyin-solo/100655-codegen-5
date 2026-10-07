import { defineStore } from 'pinia'

import { DISPATCHERS } from '@/data/watertruck'
import type { DistrictCode } from '@/data/watertruck'

export const useSessionStore = defineStore('session', {
  state: () => ({
    // 默认登录城东片区调度员；顶部可切换片区，用来演示本/跨片区权限。
    district: 'east' as DistrictCode,
    operator: DISPATCHERS.east.name,
    shiftLabel: '白班 08:00-20:00',
    scope: '城市供水厂制水运行与供水调度管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    dispatcherTitle(state): string {
      return DISPATCHERS[state.district].title
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchDistrict(district: DistrictCode) {
      this.district = district
      this.operator = DISPATCHERS[district].name
    },
  },
})
