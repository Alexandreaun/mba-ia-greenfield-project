---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-09-29
scope_description: "Upload de vídeos até 10GB, armazenamento de objetos, fila de processamento em segundo plano, extração de metadados/thumbnail via FFmpeg e entrega via streaming/download para a Fase 03."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — recebe o cliente de Object Storage, o endpoint/protocolo de upload, a fila de jobs, o disparo de processamento e a geração de URLs de streaming/download.
- `next-frontend/` — recebe a UI de upload (cliente resumível), o consumo da URL de streaming/download e a orquestração da criação do rascunho de vídeo.

Nenhuma decisão prévia em `docs/decisions/` cobre armazenamento de objetos, filas, FFmpeg ou upload resumível — este documento é greenfield nessas áreas. Convenções herdadas relevantes: configuração via `@nestjs/config` + `registerAs` + validação Joi (Fase 01); testes de integração sempre contra o serviço real do Docker Compose, nunca Testcontainers ou mocks pesados (`nestjs-project/CLAUDE.md`); modelo BFF estrito no frontend — o navegador nunca fala com a API NestJS diretamente (`next-frontend/CLAUDE.md`), o que é relevante para a TD-07 abaixo.

---

## TD-01: Object Storage Backend & SDK

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** O projeto precisa armazenar arquivos de vídeo (até 10GB) e thumbnails geradas. A arquitetura (`docs/diagrams/software-arch.mermaid`) já define o container como "Object Storage — S3 or MinIO". É preciso decidir o SDK/cliente Node a usar e como o ambiente local (Docker Compose) se relaciona com um futuro backend de produção.

**Options:**

### Option A: `@aws-sdk/client-s3` (AWS SDK v3) + MinIO local via Docker Compose
Cliente oficial da AWS, protocolo S3 padrão. Em desenvolvimento, aponta para um serviço `minio` no `compose.yaml` (S3-compatible); em produção, aponta para AWS S3 real — apenas trocando `endpoint`/credenciais via env vars. Usa `@aws-sdk/lib-storage` para uploads multipart e `@aws-sdk/s3-request-presigner` para URLs assinadas.
- **Pros:** um único código de integração para dev e produção (MinIO é S3-compatible); SDK oficial, mantido pela AWS, sem risco de abandono; `@aws-sdk/lib-storage` e `@aws-sdk/s3-request-presigner` cobrem exatamente os dois recursos necessários (multipart e URLs assinadas); Docker Compose já segue o padrão de serviços locais (`db`, `mailpit`) — `minio` se encaixa na mesma convenção.
- **Cons:** modular (vários pacotes `@aws-sdk/*`) — mais superfície de dependências que um cliente único; a API v3 é mais verbosa que a v2 (comandos como `PutObjectCommand` em vez de métodos diretos).

### Option B: Cliente oficial `minio` (SDK JS do MinIO)
Cliente Node mantido pelo próprio projeto MinIO, API mais simples e direta (`putObject`, `presignedGetObject`).
- **Pros:** API mais enxuta para o caso de uso local; documentação focada exatamente no MinIO.
- **Cons:** embora o MinIO implemente o protocolo S3, o cliente `minio` não é o cliente que a AWS S3 real espera — trocar para AWS S3 em produção exigiria reescrever a camada de storage ou manter dois clientes; menor comunidade/downloads que o AWS SDK.

### Option C: Armazenamento em disco local (sem Object Storage dedicado)
Salvar os arquivos diretamente no filesystem do container da API/worker, sem S3/MinIO.
- **Pros:** zero configuração adicional, nenhuma dependência nova.
- **Cons:** contradiz explicitamente a arquitetura definida (`docs/diagrams/software-arch.mermaid` já modela um container "Object Storage" separado); não escala além de um único host; não sobrevive a rebuilds de container sem volume dedicado; caminho migratório para produção (S3 real) exigiria reescrever tudo depois.

**Recommendation:** **Option A** — MinIO local + `@aws-sdk/client-s3`/`lib-storage`/`s3-request-presigner`. É o único caminho que atende ao "Object Storage: S3 or MinIO" do diagrama de arquitetura sem duplicar código de integração entre dev e produção: o mesmo cliente e os mesmos comandos funcionam contra MinIO local e contra AWS S3 real, trocando apenas `endpoint`/credenciais via env — consistente com o padrão de configuração namespaced já estabelecido na Fase 01.

**Decision:** A `@aws-sdk/client-s3` (AWS SDK v3) + MinIO local via Docker Compose

---

## TD-02: Upload Protocol & Resumability

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** O ponto de atenção do projeto é explícito: "o upload de até 10GB precisa ser feito de forma que não trave o sistema e permita retomar em caso de falha de conexão." Isso exige um protocolo de upload real, não um `multipart/form-data` simples — a escolha do protocolo define tanto o endpoint/servidor no backend quanto o cliente de upload no frontend, portanto é uma decisão cross-layer.

**Options:**

### Option A: Protocolo tus (`@tus/server` + `@tus/s3-store` no backend, `tus-js-client` no frontend)
Padrão aberto de upload resumível (RFC-like, adotado por Cloudflare, Supabase, Vimeo). O cliente envia o arquivo em chunks via `PATCH`; se a conexão cair, o cliente consulta o `Upload-Offset` já persistido e retoma exatamente de onde parou — nativamente, sem lógica customizada. `@tus/server` é ativamente mantido (release mais recente há poucas semanas) e é framework-agnostic (zero dependências, plugável em qualquer handler HTTP do NestJS). `@tus/s3-store` persiste os chunks diretamente no Object Storage (MinIO/S3) escolhido na TD-01.
- **Pros:** resumabilidade é a razão de existir do protocolo — não precisa ser reimplementada; `@tus/s3-store` integra diretamente com a Option A da TD-01; hooks de ciclo de vida (`onUploadCreate`, `onUploadFinish`) dão o gancho natural para a TD-03 (pré-cadastro do rascunho) e para enfileirar o job de processamento (TD-04).
- **Cons:** introduz um protocolo e duas dependências novas (`@tus/server` no backend, `tus-js-client` no frontend); é mais uma peça de infraestrutura de upload para a equipe aprender, ainda que a curva seja pequena dado que a API é bem documentada.

### Option B: S3 Multipart Upload via URLs pré-assinadas (`@aws-sdk/lib-storage` + `@aws-sdk/s3-request-presigner`)
O backend inicia um multipart upload no S3/MinIO, gera uma URL assinada por parte (chunk), e o frontend faz upload de cada parte diretamente para o storage, notificando o backend ao final para "completar" o multipart upload.
- **Pros:** usa exclusivamente a mesma dependência já escolhida na TD-01 (nenhum protocolo novo); nativo do S3, sem servidor de upload adicional.
- **Cons:** resumabilidade não é automática — é preciso implementar manualmente no frontend o rastreamento de quais partes já foram enviadas (ETags), persistir esse estado entre sessões do navegador, e lidar com a expiração das URLs assinadas em uploads longos; mais código customizado e mais superfície para bugs de borda no requisito explícito de "retomar upload".

### Option C: Upload único via `multipart/form-data` (Multer / `FileInterceptor` do NestJS)
Upload tradicional em uma única requisição HTTP, arquivo inteiro no corpo da requisição.
- **Pros:** padrão mais simples do ecossistema NestJS, zero dependências novas.
- **Cons:** não é resumível — qualquer queda de conexão em um arquivo de até 10GB reinicia o upload do zero, violando diretamente o ponto de atenção do projeto; mantém o arquivo inteiro em memória/disco temporário na API antes de repassar ao storage, contradizendo "sem impacto na performance".

**Recommendation:** **Option A (tus via `@tus/server`/`@tus/s3-store`/`tus-js-client`)** — é a única opção que resolve resumabilidade como propriedade nativa do protocolo em vez de responsabilidade customizada, que é exatamente o requisito não-funcional citado nos Pontos de Atenção do projeto. A Option B alcançaria o mesmo resultado, mas exigiria reimplementar manualmente o controle de estado que o tus já resolve.

**Decision:** A Protocolo tus (`@tus/server` + `@tus/s3-store` no backend, `tus-js-client` no frontend)

---

## TD-03: Draft Video Pre-registration Flow

**Scope:** Cross-layer

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** A capacidade exige "pré-cadastro automático do vídeo como rascunho ao iniciar o upload" — ou seja, o registro no banco precisa existir antes do upload terminar, não depois. Esta decisão depende da TD-02: o mecanismo de criação do rascunho muda conforme o protocolo de upload escolhido.

**Options:**

### Option A: Hook no ciclo de vida do tus (`onUploadCreate`)
Ao receber o `POST` inicial do tus (extensão *Creation*, antes de qualquer chunk ser enviado), um hook customizado no `@tus/server` cria a linha do vídeo (`status: draft`) no Postgres e associa o `videoId` gerado aos metadados do upload (`Upload-Metadata`). O `onUploadFinish` (quando o último chunk chega) atualiza o status e enfileira o job de processamento.
- **Pros:** um único ponto de verdade — a criação do rascunho e o início do upload são atômicos do ponto de vista do cliente (uma única chamada tus `POST`); reaproveita a metadata que o tus já transporta, sem endpoint REST adicional.
- **Cons:** acopla a lógica de domínio (criação de `Video`) ao ciclo de vida do servidor de upload — quem for debugar precisa conhecer os hooks do `@tus/server`, não apenas o `VideosModule`.

### Option B: Endpoint REST dedicado antes de iniciar o upload
O frontend chama primeiro `POST /videos` (cria a linha com `status: draft`, retorna `videoId`), e só então inicia o upload tus/multipart marcando os metadados com esse `videoId` já existente.
- **Pros:** separação clara de responsabilidades — `VideosModule` não depende de hooks do servidor de upload; mais fácil de testar isoladamente (endpoint REST comum, sem precisar simular o protocolo de upload); o padrão fica consistente independentemente de qual protocolo a TD-02 escolher (funciona igual com tus ou com S3 multipart presignado).
- **Cons:** duas chamadas em sequência (criar rascunho → iniciar upload) — se o cliente falhar entre as duas, sobra um rascunho órfão sem upload associado (mitigável com um job de limpeza periódico, fora do escopo desta fase).

**Recommendation:** **Option B** — mantém a criação do rascunho como uma operação de domínio comum (`VideosService.createDraft()`), desacoplada do protocolo de upload escolhido na TD-02. Isso respeita o princípio de responsabilidade única já adotado no projeto (`CLAUDE.md` → Working Principles) e evita que `VideosModule` precise conhecer detalhes do `@tus/server`.

**Decision:** B Endpoint REST dedicado antes de iniciar o upload

---

## TD-04: Background Job Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** O processamento de vídeo (extração de metadados, geração de thumbnail) é pesado e precisa rodar fora do ciclo de requisição HTTP, conforme o ponto de atenção "a extração de informações do vídeo é pesada e deve acontecer em segundo plano, sem bloquear o usuário." É preciso uma fila de jobs entre a API (produtora) e o Video Worker (consumidor).

**Options:**

### Option A: BullMQ + Redis
Fila madura baseada em Redis, com suporte a prioridade, jobs atrasados, rate limiting por fila e retries configuráveis. Maior base de usuários do ecossistema Node (~3.2M downloads semanais).
- **Pros:** feature-completa para pipelines de processamento (retries com backoff, concorrência configurável por worker, dashboards de monitoramento como Bull Board); ecossistema maduro, muita documentação para casos de processamento de mídia especificamente.
- **Cons:** introduz Redis como nova peça de infraestrutura — o projeto não usa Redis em nenhuma fase anterior (rate limiting da Fase 02 usa `@nestjs/throttler` em memória); mais um serviço no `compose.yaml` para subir, monitorar e (eventualmente) provisionar em produção.

### Option B: pg-boss (fila sobre PostgreSQL)
Fila de jobs que usa o Postgres já existente como armazenamento (via `SKIP LOCKED` para concorrência segura), sem exigir Redis.
- **Pros:** zero infraestrutura nova — reaproveita o Postgres que já está no `compose.yaml`; garantias ACID de uma transação relacional real (o job e a mudança de estado do vídeo podem compartilhar a mesma transação); menor superfície operacional para um projeto deste porte.
- **Cons:** throughput e conjunto de features menores que BullMQ (~312k downloads semanais, ecossistema bem menor); menos adequado se o volume de jobs crescer muito ou se forem necessários recursos avançados (flows/dependências entre jobs, rate limiting nativo por fila) nas fases futuras.

**Recommendation:** **Option B (pg-boss)** — o volume de jobs da Fase 03 é simples (um job de processamento por vídeo enviado, sem dependências entre jobs nem necessidade de rate limiting de fila), e o projeto não usa Redis em nenhuma outra parte do stack. Adicionar Redis só para a fila introduziria uma peça de infraestrutura nova cujo único consumidor seria esse único fluxo — pg-boss entrega as garantias necessárias (retry, concorrência segura) reaproveitando o Postgres já provisionado. Se fases futuras exigirem features de fila mais avançadas (prioridade complexa, flows), a migração para BullMQ pode ser revisitada como uma nova decisão.

**Decision:** B pg-boss (fila sobre PostgreSQL)

---

## TD-05: Video Worker Subproject Placement & Compose Topology

**Scope:** Repo-wide

**Capability:** Transversal — covers: "Serviço de armazenamento de arquivos (vídeos e thumbnails)", "Serviço de processamento em segundo plano (filas)", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** O diagrama de arquitetura modela o "Video Worker" como um container próprio, separado da API. É preciso decidir onde esse código vive no monorepo e como ele se conecta ao Postgres, à fila (TD-04) e ao Object Storage (TD-01) via Docker Compose — hoje `nestjs-project/` e `next-frontend/` já têm stacks Compose **separadas**, conectadas via `host.docker.internal`.

**Options:**

### Option A: Novo subprojeto de nível raiz (`video-worker/`)
Um novo diretório irmão de `nestjs-project/` e `next-frontend/`, com seu próprio `package.json`, `Dockerfile.dev` e `compose.yaml`, unindo-se à rede do `nestjs-project` (ou a uma rede compartilhada) para acessar `db` e a fila.
- **Pros:** espelha exatamente o C4 (um container = um subprojeto); responsabilidade única mais explícita — o worker não compartilha `node_modules`/dependências HTTP da API.
- **Cons:** duplica boilerplate (TypeORM `DataSource`, entidades, configuração Joi/`registerAs`) entre dois subprojetos Node, já que o monorepo não tem hoje nenhuma ferramenta de workspace (`npm workspaces`, Turborepo) decidida para compartilhar código — cada entidade (`Video`, etc.) precisaria ser mantida em dois lugares ou copiada.

### Option B: Entrypoint adicional dentro de `nestjs-project/`
O worker vive como um segundo bootstrap dentro do código já existente (`src/worker/main.ts`, usando `NestFactory.createApplicationContext` em vez de `createApplication` — sem servidor HTTP), reaproveitando as mesmas entidades, `DataSource` e módulos de configuração. No `compose.yaml` do `nestjs-project`, um novo serviço (`nestjs-worker`) usa a mesma imagem/`Dockerfile.dev`, trocando apenas o `command` (`node dist/worker/main.js` em vez de `start:dev`), e compartilha a mesma rede que já dá acesso a `db`.
- **Pros:** reaproveita diretamente as entidades TypeORM (`Video`, etc.), a configuração namespaced (`registerAs`) e o `DataSource` já estabelecidos — zero duplicação; o worker ganha acesso a `db` "de graça", já que está na mesma stack Compose; adicionar `minio` (TD-01) e a tabela de fila do pg-boss (TD-04) nesse mesmo `compose.yaml` mantém toda a infraestrutura do backend em um único lugar, consistente com a regra de Docker Networking do projeto (usar nomes de serviço do Compose).
- **Cons:** o worker deixa de ser um "container" fisicamente distinto na topologia do Compose de dev (embora continue sendo um processo/serviço distinto) — quem ler só o `docker-compose.yaml` precisa saber que `nestjs-worker` roda um `command` diferente do `nestjs-api` para perceber a separação de responsabilidade.

**Recommendation:** **Option B** — dado que o monorepo ainda não decidiu nenhuma ferramenta de workspace para compartilhar código Node entre subprojetos, criar um novo subprojeto físico (Option A) forçaria duplicar entidades e configuração ou abriria uma decisão de tooling de monorepo fora do escopo desta fase. Reaproveitar o código e a stack Compose do `nestjs-project` mantém a responsabilidade única no nível de módulo NestJS (um `WorkerModule`/bootstrap dedicado, sem HTTP), sem pagar o custo de duplicação de infraestrutura.

**Decision:** B Entrypoint adicional dentro de `nestjs-project/`

---

## TD-06: Video Processing / FFmpeg Invocation Approach

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** O Video Worker precisa extrair duração/metadados (via `ffprobe`) e gerar uma thumbnail a partir de um frame (via `ffmpeg`). A biblioteca historicamente mais popular para isso em Node, `fluent-ffmpeg`, foi **arquivada em maio de 2025** e não funciona corretamente com versões recentes do FFmpeg — não pode ser recomendada para um projeto greenfield em 2026.

**Options:**

### Option A: Invocação direta do binário via `child_process` (com `execa`)
Chamar `ffmpeg`/`ffprobe` diretamente como processos filhos, montando os argumentos manualmente (`execa("ffprobe", ["-show_format", "-show_streams", "-print_format", "json", input])` para metadados; `execa("ffmpeg", ["-ss", time, "-i", input, "-vframes", "1", output])` para thumbnail). `execa` é uma lib madura e ativamente mantida para execução de processos (melhor tratamento de erros/streams que o `child_process` puro do Node).
- **Pros:** zero dependência de um wrapper específico de FFmpeg que pode ser abandonado (como aconteceu com `fluent-ffmpeg`); controle total e explícito sobre os argumentos passados a `ffmpeg`/`ffprobe`; `execa` é amplamente usado e mantido independentemente do ecossistema de vídeo.
- **Cons:** é preciso escrever (e testar) o parsing do JSON de saída do `ffprobe` manualmente — não há uma API tipada de alto nível pronta.

### Option B: `mediaforge` (wrapper TypeScript moderno)
Sucessor declarado do `fluent-ffmpeg`, 100% tipado, API fluente, zero bindings nativos, compatível com FFmpeg v6/v7/v8.
- **Pros:** API de mais alto nível que reduz código boilerplate de parsing; tipagem forte para as operações comuns (extração de metadados, corte de frame).
- **Cons:** biblioteca muito nova (v0.3.0 na pesquisa realizada), baixíssima adoção/maturidade comprovada até o momento — repetir o risco que acabou de se concretizar com `fluent-ffmpeg` (dependência de um wrapper de baixa adoção para uma operação crítica do produto) é uma preocupação real para uma decisão de longo prazo.

**Recommendation:** **Option A (`execa` + invocação direta de `ffmpeg`/`ffprobe`)** — depois do abandono do `fluent-ffmpeg`, apostar em outro wrapper de terceiros de baixíssima adoção (`mediaforge`, v0.3.0) repete o mesmo risco que acabou de se materializar. Chamar os binários diretamente com `execa` é mais verboso, mas a superfície de manutenção fica limitada a uma lib de execução de processos genérica (não específica de FFmpeg) que não some do dia para a noite.

**Decision:** A Invocação direta do binário via `child_process` (com `execa`)

---

## TD-07: Streaming & Download Delivery Mechanism

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** O vídeo processado precisa ser entregue ao navegador tanto para reprodução via streaming (com suporte a HTTP Range, para permitir seek sem baixar o arquivo inteiro) quanto para download direto. O diagrama de arquitetura já modela uma relação direta `Frontend --Streams--> Object Storage` — diferente do restante do tráfego do frontend, que segue o modelo BFF estrito (`next-frontend/CLAUDE.md`: "o navegador nunca fala com a API NestJS diretamente"). É importante notar que essa relação direta é com o **Object Storage**, não com a API NestJS — não é uma violação da regra de BFF, é uma exceção arquitetural já prevista no C4 para esse fluxo específico.

**Options:**

### Option A: URLs assinadas (presigned GET) direto do Object Storage
A API gera uma URL assinada com expiração curta (via `@aws-sdk/s3-request-presigner`, mesma lib da TD-01) apontando diretamente para o objeto no MinIO/S3. O navegador usa essa URL como `src` do `<video>` (streaming, com Range nativo do storage) ou como link de download (com `Content-Disposition: attachment`, response-header override suportado nativamente por presigned URLs S3).
- **Pros:** consistente com a relação `Frontend → Storage` já desenhada no C4; suporte a Range requests é nativo do storage (S3/MinIO), sem precisar implementar manualmente; nenhuma banda passante do vídeo passa pela API, que fica livre para lidar apenas com metadados/autorização.
- **Cons:** exige gerar e expirar corretamente as URLs assinadas (janela de expiração precisa ser curta o suficiente para segurança, mas longa o suficiente para não expirar no meio de uma sessão longa de streaming).

### Option B: API faz proxy/stream dos bytes do storage
A API lê o objeto do storage e repassa via stream (`res.pipe()`) para o cliente, implementando manualmente o suporte a `Range` (HTTP 206 Partial Content).
- **Pros:** o endereço do storage nunca é exposto ao navegador; ponto único de controle de acesso na própria API.
- **Cons:** contradiz a relação direta `Frontend → Storage` já modelada na arquitetura; toda a banda passante de vídeo (potencialmente arquivos de até 10GB) passa pela API, indo contra o ponto de atenção de performance; implementar suporte correto a Range requests manualmente é retrabalho do que o storage já oferece de graça.

**Recommendation:** **Option A** — segue exatamente a relação `Frontend → Storage` já definida no C4 (`docs/diagrams/software-arch.mermaid`), evita transformar a API num proxy de banda larga para arquivos de até 10GB, e reaproveita o suporte nativo a Range/`Content-Disposition` do storage sem código adicional. A regra de BFF estrito do frontend continua vigente para toda comunicação com a API NestJS — este fluxo é a exceção documentada no próprio diagrama de arquitetura, não uma contradição dela.

**Decision:** A URLs assinadas (presigned GET) direto do Object Storage

---

## TD-08: Object Storage Key Strategy & Uniqueness Guarantee

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** TD-01 decide o cliente de storage, TD-03 decide que o rascunho do vídeo (com seu `id` UUID gerado pelo Postgres) existe antes do upload começar, TD-06 decide como o worker gera a thumbnail, e TD-07 decide como a URL de streaming/download é montada a partir de uma chave de objeto. Nenhuma dessas TDs define, porém, **qual é literalmente a chave do objeto** no bucket — o formato exato que `VideosService` (upload), o worker (thumbnail) e o gerador de URL assinada (TD-07) precisam concordar byte-a-byte para apontar ao mesmo objeto. Sem essa decisão, cada camada poderia inventar seu próprio esquema de nomes e colidir ou divergir silenciosamente. O projeto já segue a convenção `@PrimaryGeneratedColumn('uuid')` para toda entidade (`.claude/rules/nestjs-entities.md`), o que é o ponto de partida natural para a chave.

**Options:**

### Option A: Chave plana baseada no UUID do vídeo (`{videoId}.{ext}` / `{videoId}-thumbnail.jpg`)
A chave do objeto original é o próprio `Video.id` (UUID v4 gerado pelo Postgres em TD-03, antes do upload iniciar) mais a extensão do arquivo; a thumbnail usa o mesmo `videoId` com um sufixo fixo. Nenhuma estrutura de pastas por canal/usuário.
- **Pros:** reaproveita 100% a garantia de unicidade que já existe no banco — um UUID v4 tem ~122 bits de entropia (colisão astronomicamente improvável, muito antes do PK único do Postgres já rejeitar um ID duplicado); zero dependência nova; chave trivial de calcular em qualquer camada (`videoId` já está disponível desde a criação do rascunho em TD-03); nenhuma necessidade de validação de colisão em tempo de upload.
- **Cons:** bucket "flat" com todos os objetos no mesmo nível lógico — não há agrupamento por canal para políticas de lifecycle futuras (ex.: "apagar todos os vídeos do canal X" exigiria uma query ao Postgres para listar os IDs antes de apagar no storage, em vez de um prefixo de pasta).

### Option B: Chave namespaced por canal (`{channelId}/{videoId}/original.{ext}` / `{channelId}/{videoId}/thumbnail.jpg`)
Mesmo esquema de unicidade da Option A (o UUID do vídeo é o componente que garante não-colisão), mas prefixado pelo `channelId` do dono do vídeo.
- **Pros:** mesma garantia de unicidade da Option A; organização lógica por canal facilita auditoria manual e políticas de lifecycle/exportação por canal no futuro.
- **Cons:** acopla a chave do objeto ao `channelId` no momento da criação — se o produto algum dia permitir mover um vídeo entre canais (não previsto hoje), a chave precisaria ser reescrita; mais um parâmetro (`channelId`) que toda camada que monta a chave (upload, worker, gerador de URL) precisa receber e concatenar corretamente — mais um ponto de erro de integração.

### Option C: Chave content-addressed (hash SHA-256 do conteúdo do arquivo)
A chave é derivada de um hash do conteúdo binário do vídeo, permitindo deduplicação automática entre uploads idênticos.
- **Pros:** deduplicação nativa de conteúdo idêntico; garantia de integridade "de fábrica" (o hash também serve para validar o arquivo pós-download).
- **Cons:** exige ler o arquivo inteiro para calcular o hash — para arquivos de até 10GB isso é custoso e conflita com TD-02 (upload resumível via tus processado em chunks, sem necessariamente materializar o arquivo inteiro de uma vez); deduplicação de conteúdo não é um requisito do projeto (cada vídeo é uma entidade de domínio própria mesmo que dois usuários subam o mesmo arquivo); quebra a relação 1:1 natural e direta entre `Video.id` e o objeto no storage que as Options A/B preservam.

**Recommendation:** **Option A** — a garantia de unicidade já existe de graça no UUID v4 que o Postgres gera para `Video.id` em TD-03; usar esse mesmo valor como chave do objeto elimina qualquer decisão adicional de "como evitar colisão" (matematicamente já é desprezível) e mantém o cálculo da chave idêntico e trivial em toda camada que precisa dele (upload handler, worker FFmpeg, gerador de URL assinada da TD-07). A Option B é uma evolução legítima se políticas de lifecycle por canal se tornarem necessárias — mas introduzir esse acoplamento agora, sem um requisito concreto que o justifique nesta fase, é escopo prematuro.

**Decision:** A Chave plana baseada no UUID do vídeo (`{videoId}.{ext}` / `{videoId}-thumbnail.jpg`)

---

## TD-09: Video Processing Status Lifecycle & Failure Handling

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** TD-03 decide que o rascunho do vídeo é criado com `status: draft` antes do upload, e TD-04/TD-06 decidem a fila (pg-boss) e a ferramenta (ffmpeg/ffprobe via `execa`) que processam o vídeo depois do upload terminar. Nenhuma TD, porém, define (i) quais são os valores do enum de status do vídeo ao longo do ciclo completo, (ii) o que acontece quando o job de processamento falha (arquivo corrompido, `ffprobe` sem conseguir ler o container, timeout), e (iii) se artefatos parciais (ex.: uma thumbnail parcialmente escrita antes da falha) ficam órfãos no storage. O pg-boss (fila já recomendada em TD-04) tem suporte nativo a retry configurável (`retryLimit`, `retryDelay`, `retryBackoff` com backoff exponencial) e a uma dead-letter queue (`deadLetter: '<queue>'`) para jobs que esgotam as tentativas — a decisão aqui é como o **modelo de domínio** (`Video.status`) reage a esses eventos de infraestrutura, não como o pg-boss funciona internamente.

**Options:**

### Option A: Enum granular + retry automático do pg-boss + DLQ dedicada + artefatos parciais preservados
`Video.status`: `draft → uploaded → processing → ready | failed`. O job de processamento é criado com `retryLimit: 3, retryBackoff: true, deadLetter: 'video-processing-dlq'`; cada tentativa falha fica registrada pelo próprio pg-boss, e só quando as tentativas se esgotam (job cai na DLQ) o worker marca `Video.status = 'failed'`. Artefatos já escritos no storage antes da falha (ex.: thumbnail parcial) não são deletados automaticamente — ficam disponíveis para diagnóstico manual. O usuário descobre o status via polling do endpoint do vídeo (mesmo endpoint que TD-07 já assume para obter a URL de streaming), sem mecanismo de notificação ativa.
- **Pros:** usa os recursos nativos do pg-boss (retry + backoff + DLQ) sem nenhum código customizado de retry; a DLQ dá um ponto único de observação para jobs que falharam definitivamente; enum granular dá visibilidade clara de onde o vídeo está no pipeline para qualquer consumidor futuro (painel de gerenciamento na Fase 04); preservar artefatos parciais custa zero código extra agora e ajuda debugging em produção.
- **Cons:** artefatos parciais órfãos acumulam no storage sem rotina de limpeza automática (custo de armazenamento crescente ao longo do tempo — aceitável no volume inicial do projeto, mas exigirá uma rotina de limpeza em fase futura); sem notificação ativa, o usuário só percebe a falha ao revisitar a página.

### Option B: Mesmo enum e retry, mas com limpeza automática de artefatos parciais no caminho de falha
Idêntico à Option A, exceto que o `catch` do worker, antes de marcar `status: failed`, deleta explicitamente qualquer objeto já escrito no storage para aquele `videoId` (thumbnail parcial, etc.).
- **Pros:** evita acúmulo de lixo no storage; estado final mais "limpo" — ou o vídeo está `ready` com todos os artefatos, ou está `failed` sem nenhum artefato associado.
- **Cons:** mais código no caminho de erro (é preciso rastrear quais chaves foram efetivamente escritas por tentativa para saber o que deletar, e tratar o caso de falha *durante* a própria limpeza); complexidade que não se paga no volume inicial de uploads do projeto.

### Option C: Sem retry automático (`retryLimit: 0`) — falha é sempre terminal na primeira tentativa
O job de processamento não usa o retry do pg-boss; qualquer erro na primeira tentativa já marca `status: failed` imediatamente. Reprocessamento só ocorre via ação manual futura (fora do escopo desta fase).
- **Pros:** comportamento mais previsível e fácil de depurar — uma falha é sempre a falha real, nunca mascarada por uma segunda tentativa; menos carga no worker sob picos de erro sistêmico.
- **Cons:** falhas transitórias (hiccup momentâneo de rede com o MinIO/S3, por exemplo) que teriam sucesso numa segunda tentativa automática agora exigem que o usuário refaça o upload inteiro de um arquivo de até 10GB — péssima experiência para o caso mais comum de falha (transitória), justamente o caso que o retry automático do pg-boss resolve de graça.

**Recommendation:** **Option A** — aproveita o retry + backoff + DLQ nativos do pg-boss (já decidido em TD-04) sem nenhum código customizado, cobrindo o caso comum de falha transitória sem exigir reupload manual; aceita o custo de artefatos parciais órfãos como aceitável no volume inicial do projeto, deixando uma rotina de limpeza para uma fase futura de operação/observability caso o volume justifique — a Option B resolve um problema de custo de armazenamento que ainda não existe, antecipando complexidade. Notificação ativa (push/toast) fica fora de escopo nesta fase: a capability do projeto não pede WebSocket/SSE, e o padrão de polling via GET já é o que TD-07 assume para a URL de streaming.

**Decision:** A Enum granular + retry automático do pg-boss + DLQ dedicada + artefatos parciais preservados

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Object Storage Backend & SDK | A — MinIO + `@aws-sdk/client-s3`/`lib-storage`/`s3-request-presigner` | A — `@aws-sdk/client-s3` (AWS SDK v3) + MinIO local via Docker Compose |
| TD-02 | Cross-layer | Upload Protocol & Resumability | A — tus (`@tus/server` + `@tus/s3-store` + `tus-js-client`) | A — Protocolo tus (`@tus/server` + `@tus/s3-store` no backend, `tus-js-client` no frontend) |
| TD-03 | Cross-layer | Draft Video Pre-registration Flow | B — Endpoint REST dedicado antes do upload | B — Endpoint REST dedicado antes de iniciar o upload |
| TD-04 | Backend | Background Job Queue Technology | B — pg-boss (sobre Postgres, sem Redis) | B — pg-boss (fila sobre PostgreSQL) |
| TD-05 | Repo-wide | Video Worker Subproject Placement & Compose Topology | B — Entrypoint adicional dentro de `nestjs-project/` | B — Entrypoint adicional dentro de `nestjs-project/` |
| TD-06 | Backend | Video Processing / FFmpeg Invocation Approach | A — `execa` + invocação direta de `ffmpeg`/`ffprobe` | A — Invocação direta do binário via `child_process` (com `execa`) |
| TD-07 | Cross-layer | Streaming & Download Delivery Mechanism | A — URLs assinadas direto do Object Storage | A — URLs assinadas (presigned GET) direto do Object Storage |
| TD-08 | Backend | Object Storage Key Strategy & Uniqueness Guarantee | A — Chave plana baseada no UUID do vídeo | A — Chave plana baseada no UUID do vídeo |
| TD-09 | Backend | Video Processing Status Lifecycle & Failure Handling | A — Enum granular + retry/backoff/DLQ nativos do pg-boss | A — Enum granular + retry automático do pg-boss + DLQ dedicada + artefatos parciais preservados |
