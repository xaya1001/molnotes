<script setup lang="ts">
import ProblemBlock from "./ProblemBlock.vue";
import SourceText from "./SourceText.vue";
import SourcePages from "./SourcePages.vue";
import RecordCollection from "./RecordCollection.vue";
import ClaimsBlock from "./ClaimsBlock.vue";
import SynthesisNetwork from "./SynthesisNetwork.vue";
import SarCases from "./SarCases.vue";
import { computed } from "vue";
import Formula from "../Formula.vue";
import LineChart from "../LineChart.vue";
import MechanismViewer from "../MechanismViewer.vue";
import MoleculeCompare from "./MoleculeCompare.vue";
import MolecularProperties from "../MolecularProperties.vue";
import MoleculeView from "../MoleculeView.vue";
import ReadingGuide from "../ReadingGuide.vue";
import SourceExcerpt from "../SourceExcerpt.vue";
import SubstituentExplorer from "../SubstituentExplorer.vue";
import SynthesisRoute from "../SynthesisRoute.vue";
import UiFigure from "../UiFigure.vue";
import DataScatterExplorer from "../data/DataScatterExplorer.vue";
import { defineDataTable } from "../data/values";
import StructureLab from "../structure/StructureLab.vue";
import { defineStructureSet } from "../structure/model";
import FlowFigure from "../diagrams/FlowFigure.vue";
import TimelineFigure from "../diagrams/TimelineFigure.vue";
import { defineFlow } from "../diagrams/flow";
import { defineTimeline } from "../diagrams/model";
import type { TopicBlock } from "./blocks";
import ChapterPrediction from "./ChapterPrediction.vue";
import { blockPieces, sourceIdsOf } from "./chapter-text";
import { useTopic } from "./context";
import LabBlock from "./LabBlock.vue";
import MatrixBlock from "./MatrixBlock.vue";
import { predictionAnswered } from "./prediction";
import QuizQuestion from "./QuizQuestion.vue";
import DiagnosticSummary from "./DiagnosticSummary.vue";
import PathPicker from "./PathPicker.vue";
import TabsBlock from "./TabsBlock.vue";
import SceneViewer from "./SceneViewer.vue";
import SpectrumBlock from "./SpectrumBlock.vue";
import TopicRefs from "./TopicRefs.vue";
import TopicTable from "./TopicTable.vue";
import TopicTerm from "./TopicTerm.vue";

/** A chapter's blocks in order, with source and glossary links in prose. */
const props = defineProps<{ chapter: string; blocks: TopicBlock[] }>();
const { content, records } = useTopic();
// The sources page renders its intro blocks under the id "sources", which has no terms.
const terms = computed(
  () => content.chapters.find((c) => c.id === props.chapter)?.terms ?? [],
);
const sourceIds = sourceIdsOf(content.sources);
const firstPrediction = computed(() =>
  props.blocks.findIndex((block) => block.type === "prediction"),
);
const hasPredictionHeading = computed(
  () =>
    props.blocks[firstPrediction.value - 1]?.type === "heading" ||
    props.blocks.some(
      (block) => block.type === "heading" && block.text === "先预测，再揭晓",
    ),
);
const pieces = computed(() =>
  blockPieces(props.blocks, terms.value, sourceIds),
);
// The data components check their input once, when the chapter opens.
const prepared = props.blocks.map((block) =>
  block.type === "data-table"
    ? defineDataTable(content.dataOf(block.table))
    : block.type === "structure-lab"
      ? defineStructureSet(content.dataOf(block.set))
      : block.type === "timeline"
        ? defineTimeline(content.dataOf(block.timeline))
        : block.type === "flow"
          ? defineFlow(content.dataOf(block.flow))
          : null,
);
const timeline = (index: number) => {
  const value = prepared[index];
  if (!value || !("lanes" in value)) throw new Error("Not a timeline");
  return value;
};
const flow = (index: number) => {
  const value = prepared[index];
  if (!value || !("edges" in value)) throw new Error("Not a flow");
  return value;
};
const dataTable = (index: number) => {
  const table = prepared[index];
  if (!table || !("rows" in table)) throw new Error("Not a data table");
  return table;
};
const structureSet = (index: number) => {
  const set = prepared[index];
  if (!set || !("entries" in set)) throw new Error("Not a structure set");
  return set;
};
const entryOf = (id: string) => {
  const entry = content.predictions.find((item) => item.id === id);
  if (!entry) throw new Error(`Unknown prediction ${id}`);
  return entry;
};
const answeredCount = (block: {
  questions: string[];
  diagnostic?: boolean;
}) => {
  const bank = block.diagnostic
    ? records.records.diagnostic
    : records.records.answers;
  return block.questions.filter((id) => bank[id] !== undefined).length;
};
const toneClass = (tone?: string) =>
  tone && tone !== "note" ? `callout--${tone}` : "";
</script>

<template>
  <template v-for="(block, index) in blocks" :key="index">
    <SourcePages v-if="block.type === 'source-pages'" :source="block.source" />
    <SynthesisNetwork
      v-else-if="block.type === 'synthesis-network'"
      :network="block.network"
    />
    <RecordCollection
      v-else-if="block.type === 'record-collection'"
      :collection="block.collection"
    />
    <ClaimsBlock v-else-if="block.type === 'claims'" :set="block.set" />
    <SarCases
      v-else-if="block.type === 'sar-cases'"
      :cases="block.cases"
      :collection="block.collection"
    />
    <component
      :is="`h${block.level ?? 2}`"
      v-else-if="block.type === 'heading'"
      >{{ block.text }}</component
    >
    <p v-else-if="block.type === 'paragraph'">
      <template v-for="(piece, j) in pieces[index]" :key="j">
        <TopicTerm v-if="piece.kind === 'term'" :name="piece.name" />
        <TopicRefs v-else-if="piece.kind === 'refs'" :ids="piece.ids" />
        <SourceText v-else :text="piece.text" />
      </template>
    </p>
    <p
      v-else-if="block.type === 'callout'"
      class="callout"
      :class="toneClass(block.tone)"
    >
      <template v-for="(piece, j) in pieces[index]" :key="j">
        <TopicTerm v-if="piece.kind === 'term'" :name="piece.name" />
        <TopicRefs v-else-if="piece.kind === 'refs'" :ids="piece.ids" />
        <SourceText v-else :text="piece.text" />
      </template>
      <a v-if="block.link" :href="block.link.to">{{ block.link.text }}</a>
    </p>
    <figure v-else-if="block.type === 'formula'" class="figure">
      <Formula :tex="block.tex" />
      <figcaption v-if="block.caption" class="caption">
        {{ block.caption }}
      </figcaption>
    </figure>
    <ol v-else-if="block.type === 'list' && block.ordered">
      <li v-for="item in block.items" :key="item">{{ item }}</li>
    </ol>
    <ul v-else-if="block.type === 'list'">
      <li v-for="item in block.items" :key="item">{{ item }}</li>
    </ul>
    <figure v-else-if="block.type === 'molecule'" class="figure">
      <MoleculeView
        :name="block.name"
        :smiles="block.smiles"
        :highlight-atoms="block.highlightAtoms"
        :highlight-bonds="block.highlightBonds"
        :labels="block.labels"
      />
      <figcaption v-if="block.caption" class="caption">
        {{ block.caption }}
      </figcaption>
    </figure>
    <MoleculeCompare
      v-else-if="block.type === 'molecule-compare'"
      :items="content.dataOf(block.items)"
      :left="block.left"
      :right="block.right"
      :highlight-label="block.highlightLabel"
    />
    <figure v-else-if="block.type === 'molecules'" class="figure">
      <div class="molecules">
        <MoleculeView
          v-for="item in content.dataOf(block.items)"
          :key="item.name"
          :name="item.name"
          :smiles="item.smiles"
        />
      </div>
      <figcaption v-if="block.caption" class="caption">
        {{ block.caption }}
      </figcaption>
    </figure>
    <template v-else-if="block.type === 'properties'">
      <MoleculeView :name="block.name" :smiles="block.smiles" />
      <MolecularProperties :smiles="block.smiles" />
    </template>
    <SubstituentExplorer
      v-else-if="block.type === 'substituents'"
      :site="block.site"
      :variants="content.dataOf(block.variants)"
    />
    <SynthesisRoute
      v-else-if="block.type === 'route'"
      :routes="content.dataOf(block.routes)"
    />
    <template v-else-if="block.type === 'mechanism'">
      <h3 v-if="block.title">{{ block.title }}</h3>
      <MechanismViewer :frames="content.dataOf(block.frames)" />
    </template>
    <TopicTable
      v-else-if="block.type === 'table'"
      :caption="block.caption"
      :columns="block.columns"
      :rows="content.dataOf(block.rows)"
      :note="block.note"
      :row-header="block.rowHeader"
    />
    <SpectrumBlock
      v-else-if="block.type === 'spectrum'"
      :block="block"
      :assigned="
        (block.assignAfter ?? []).every((id) =>
          predictionAnswered(entryOf(id), records.records),
        )
      "
    />
    <DataScatterExplorer
      v-else-if="block.type === 'data-table'"
      :table="dataTable(index)"
      :title="block.title"
      :label="block.label"
      :noun="block.noun"
      :id-label="block.idLabel"
      :missing="block.missing"
      :default-x="block.defaultX"
      :default-y="block.defaultY"
    />
    <StructureLab
      v-else-if="block.type === 'structure-lab'"
      :set="structureSet(index)"
      :ids="block.ids"
    />
    <SourceExcerpt
      v-else-if="block.type === 'excerpt'"
      :excerpt="content.excerptById(block.excerpt)"
      :sources="content.sources"
    />
    <UiFigure
      v-else-if="block.type === 'figure'"
      :src="block.src"
      :alt="block.alt"
      :caption="block.caption"
    />
    <figure v-else-if="block.type === 'chart'" class="figure">
      <LineChart
        :points="content.dataOf(block.points)"
        :x-label="block.xLabel"
        :y-label="block.yLabel"
        :x-domain="block.xDomain"
        :y-domain="block.yDomain"
      />
      <figcaption v-if="block.caption" class="caption">
        {{ block.caption }}
      </figcaption>
    </figure>
    <TimelineFigure
      v-else-if="block.type === 'timeline'"
      class="figure"
      :timeline="timeline(index)"
      :caption="block.caption"
    />
    <FlowFigure
      v-else-if="block.type === 'flow'"
      class="figure"
      :flow="flow(index)"
      :caption="block.caption"
    />
    <DiagnosticSummary
      v-else-if="block.type === 'diagnostic-summary'"
      :title="block.title"
    />
    <PathPicker v-else-if="block.type === 'path-picker'" :title="block.title" />
    <TabsBlock
      v-else-if="block.type === 'tabs'"
      :block="block"
      :chapter="chapter"
    />
    <SceneViewer
      v-else-if="block.type === 'scene'"
      :label="block.label"
      :title="block.title"
      :frames="content.dataOf(block.frames)"
    />
    <ProblemBlock
      v-else-if="block.type === 'problem'"
      :block="block"
      :chapter="chapter"
    />
    <template v-else-if="block.type === 'prediction'">
      <h2 v-if="index === firstPrediction && !hasPredictionHeading">
        先预测，再揭晓
      </h2>
      <ChapterPrediction
        :id="block.id ?? chapter"
        :key="block.id ?? chapter"
        :prediction="block"
      />
    </template>
    <MatrixBlock
      v-else-if="block.type === 'matrix'"
      :id="block.id ?? chapter"
      :key="block.id ?? chapter"
      :block="block"
    />
    <LabBlock
      v-else-if="block.type === 'lab'"
      :block="block"
      :data="block.data ? content.dataOf(block.data) : undefined"
    />
    <template v-else-if="block.type === 'quiz'">
      <p aria-live="polite">
        已回答 {{ answeredCount(block) }} / {{ block.questions.length }} 题
      </p>
      <QuizQuestion
        v-for="id in block.questions"
        :id="id"
        :key="id"
        :diagnostic="block.diagnostic"
      />
    </template>
    <template v-else-if="block.type === 'reading'">
      <h2 v-if="block.title">{{ block.title }}</h2>
      <ReadingGuide
        :items="
          (block.scope === 'chapter'
            ? content.chapterById(chapter).reading
            : content.reading) ?? []
        "
        :sources="content.sources"
      />
    </template>
  </template>
</template>

<style scoped>
.molecules {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: var(--space-3);
}
</style>
