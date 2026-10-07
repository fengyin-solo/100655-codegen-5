import { defineStore } from 'pinia'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市供水厂制水运行与供水调度管理平台',
    // 当前调度员所属片区：应急送水车按片区归属派车，越权操作以此为界。
    district: '城东片区',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setDistrict(label: string) {
      this.district = label
    },
  },
})
