/**
 * High-signal domain vocabulary. A term appearing here is very likely the thing
 * the user actually wants explained, so it outranks generic nouns during scoring.
 *
 * This is deliberately a *boost* list, not a filter: unknown terms still score on
 * rarity and position, so the tool works for topics nobody listed here.
 */

const RAW = {
  data: `database sql nosql postgres postgresql mysql sqlite mongodb redis cassandra dynamodb
    clickhouse duckdb elasticsearch migration schema index indexing sharding partitioning replication
    transaction acid isolation deadlock normalization denormalization query planner explain analyze
    b-tree vacuum wal foreign key primary key join outer join cte window function materialized view
    data warehouse etl elt olap oltp columnar parquet avro orm connection pool`,

  distributed: `distributed systems consensus raft paxos cap theorem eventual consistency quorum
    leader election vector clock lamport gossip protocol two phase commit saga idempotency
    load balancer reverse proxy service mesh circuit breaker backpressure rate limiting
    message queue kafka rabbitmq pubsub event sourcing cqrs microservices monolith`,

  infra: `docker kubernetes container orchestration helm terraform ansible ci cd pipeline
    serverless lambda virtual machine hypervisor namespace cgroup systemd nginx caddy
    dns tls ssl certificate load testing observability tracing opentelemetry prometheus grafana
    blue green deployment canary rollback infrastructure as code`,

  lang: `garbage collection memory management pointer reference borrow checker ownership lifetime
    closure recursion tail call currying monad functor immutability concurrency parallelism
    thread process coroutine async await promise event loop mutex semaphore race condition
    type system generics polymorphism inheritance composition dependency injection
    compiler interpreter jit bytecode ast parser lexer linker abi ffi`,

  algo: `algorithm complexity big o time complexity space complexity sorting binary search
    hash table linked list binary tree graph traversal breadth first depth first dijkstra
    dynamic programming memoization greedy backtracking bloom filter trie heap priority queue
    union find topological sort knapsack levenshtein regex finite automaton`,

  ml: `machine learning neural network deep learning transformer attention mechanism
    backpropagation gradient descent overfitting regularization dropout batch normalization
    embedding tokenization fine tuning rlhf reinforcement learning diffusion model
    convolutional recurrent lstm gan autoencoder clustering k means random forest
    gradient boosting bayes theorem cross validation confusion matrix precision recall
    large language model prompt engineering retrieval augmented generation vector database
    quantization inference latency context window mixture of experts`,

  web: `http https rest graphql websocket grpc cors csrf xss sql injection cookie session
    jwt oauth saml sso authentication authorization hashing bcrypt salt encryption
    public key cryptography symmetric asymmetric tls handshake zero trust
    react vue svelte hydration server side rendering virtual dom reconciliation
    css grid flexbox specificity box model reflow repaint web assembly service worker
    caching cdn etag content security policy same origin policy`,

  git: `git rebase cherry pick bisect reflog merge conflict submodule monorepo trunk based
    semantic versioning pull request code review branching strategy`,

  science: `photosynthesis mitosis meiosis dna rna transcription translation crispr enzyme
    protein folding cell membrane osmosis diffusion homeostasis evolution natural selection
    genetics chromosome ribosome atp krebs cycle glycolysis respiration ecosystem
    entropy thermodynamics quantum mechanics relativity electromagnetism gravity
    photon electron proton neutron isotope periodic table covalent bond ionic bond
    catalyst oxidation reduction acid base ph molarity stoichiometry
    plate tectonics climate carbon cycle nitrogen cycle greenhouse effect`,

  math: `calculus derivative integral limit differential equation linear algebra matrix
    eigenvalue eigenvector vector space determinant probability distribution normal distribution
    bayesian statistics standard deviation variance regression correlation hypothesis testing
    p value confidence interval central limit theorem fourier transform topology
    set theory proof by induction combinatorics permutation modular arithmetic prime factorization`,

  money: `compound interest inflation interest rate bond yield equity valuation cash flow
    balance sheet income statement depreciation amortization option pricing arbitrage
    supply demand elasticity opportunity cost marginal utility game theory nash equilibrium
    monetary policy fiscal policy gdp recession market maker order book`,

  misc: `design pattern singleton observer factory adapter facade solid principles
    technical debt refactoring test driven development unit test integration test mocking
    accessibility internationalization localization rate limit idempotent api versioning
    system design scalability availability durability latency throughput`,
};

/** Single tokens that are strong topic signals on their own. */
export const LEXICON_UNIGRAMS = new Set<string>();
/** Multi-word phrases; matched greedily so "cap theorem" beats "theorem". */
export const LEXICON_PHRASES: string[] = [];

for (const block of Object.values(RAW)) {
  for (const w of block.replace(/\s+/g, ' ').trim().split(' ')) {
    if (w.length > 2) LEXICON_UNIGRAMS.add(w);
  }
}

// Curated multi-word concepts, listed explicitly because phrase boundaries matter.
const PHRASE_SOURCE = [
  'cap theorem', 'eventual consistency', 'vector clock', 'two phase commit', 'event sourcing',
  'garbage collection', 'borrow checker', 'race condition', 'dynamic programming', 'binary search',
  'hash table', 'linked list', 'binary tree', 'breadth first search', 'depth first search',
  'bloom filter', 'priority queue', 'union find', 'topological sort', 'time complexity',
  'space complexity', 'big o notation', 'neural network', 'deep learning', 'attention mechanism',
  'gradient descent', 'batch normalization', 'fine tuning', 'reinforcement learning',
  'large language model', 'prompt engineering', 'context window', 'retrieval augmented generation',
  'vector database', 'mixture of experts', 'server side rendering', 'virtual dom', 'css grid',
  'box model', 'content security policy', 'same origin policy', 'sql injection',
  'public key cryptography', 'tls handshake', 'zero trust', 'connection pool', 'foreign key',
  'primary key', 'window function', 'materialized view', 'query planner', 'database migration',
  'schema migration', 'index scan', 'sequential scan', 'distributed systems', 'leader election',
  'circuit breaker', 'rate limiting', 'message queue', 'infrastructure as code',
  'blue green deployment', 'natural selection', 'cell membrane', 'protein folding', 'krebs cycle',
  'carbon cycle', 'greenhouse effect', 'quantum mechanics', 'plate tectonics', 'periodic table',
  'covalent bond', 'linear algebra', 'differential equation', 'normal distribution',
  'standard deviation', 'central limit theorem', 'fourier transform', 'hypothesis testing',
  'confidence interval', 'bayes theorem', 'game theory', 'nash equilibrium', 'compound interest',
  'interest rate', 'opportunity cost', 'supply and demand', 'monetary policy', 'cash flow',
  'balance sheet', 'design pattern', 'technical debt', 'test driven development', 'system design',
  'merge conflict', 'cherry pick', 'semantic versioning', 'dependency injection', 'type system',
  'memory management', 'event loop', 'service mesh', 'load balancer', 'reverse proxy',
  // Terms the scoring heuristics handle badly on their own, usually because a
  // component word is common chat filler ("write", "read", "log", "change").
  'write ahead log', 'change data capture', 'read replica', 'hash map',
  'content delivery network', 'binary search tree', 'message broker',
  'load balancing', 'feature flag', 'idempotency key', 'connection pooling',
  'database index', 'query optimizer', 'lock contention', 'thread pool',
  'explain analyze', 'query plan',
];
LEXICON_PHRASES.push(...PHRASE_SOURCE.sort((a, b) => b.length - a.length));

/** Domain hint used to bias the final search query wording. */
export function domainOf(term: string): string | null {
  for (const [domain, block] of Object.entries(RAW)) {
    if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(block)) return domain;
  }
  return null;
}
