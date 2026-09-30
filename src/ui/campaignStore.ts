import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type CampaignStore = {
  stars: Record<number, number>
  setStars: (stageId: number, stars: number) => void
  isUnlocked: (stageId: number) => boolean
}

export const useCampaignStore = create<CampaignStore>()(
  persist(
    (set, get) => ({
      stars: {},
      setStars: (stageId, stars) => set((s) => {
        const current = s.stars[stageId] || 0
        if (stars > current) {
          return { stars: { ...s.stars, [stageId]: stars } }
        }
        return s
      }),
      isUnlocked: (stageId) => {
        if (stageId === 1) return true
        const prev = get().stars[stageId - 1] || 0
        return prev >= 1
      }
    }),
    {
      name: 'chart-drill-campaign'
    }
  )
)
