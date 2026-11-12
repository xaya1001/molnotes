import {
  computed,
  provide,
  shallowReactive,
  type ComputedRef,
  type InjectionKey,
} from "vue";
interface Preview {
  width: number;
  available: number;
  minimumScale: number;
}
interface TableScale {
  scale: ComputedRef<number>;
  previews: Set<Preview>;
}
export const tableStructureScales: InjectionKey<{
  register(
    table: Element,
    preview: Preview,
  ): { scale: ComputedRef<number>; remove(): void };
}> = Symbol("tableStructureScales");

/** Every drawing in one table uses the widest drawing's fitting scale and the common readability floor. */
export function provideTableStructureScales() {
  const tables = new WeakMap<Element, TableScale>();
  provide(tableStructureScales, {
    register(table, preview) {
      let group = tables.get(table);
      if (!group) {
        const previews = shallowReactive(new Set<Preview>());
        group = {
          previews,
          scale: computed(() =>
            Math.max(
              ...[...previews].map((p) => p.minimumScale),
              Math.min(
                0.75,
                ...[...previews].map((p) => p.available / p.width),
              ),
            ),
          ),
        };
        tables.set(table, group);
      }
      const { previews, scale } = group;
      previews.add(preview);
      return { scale, remove: () => previews.delete(preview) };
    },
  });
}
