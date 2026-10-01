# Embeddings locales (BAAI/bge-m3)

Servidor de embeddings opcional para el RAG de los documentos, para usarlo sin OpenRouter y sin
clave. Corre [Text Embeddings Inference](https://github.com/huggingface/text-embeddings-inference)
(imagen CPU, versión fijada) con el modelo `BAAI/bge-m3` (1024 dimensiones) y expone una API
compatible con OpenAI en `POST /v1/embeddings`.

Vive bajo el perfil `embeddings-local`: el `docker compose up` normal **no** lo levanta. Es solo de
red interna: no publica ningún puerto en el host; el backend lo alcanza como `http://embeddings:80`
(`EMBEDDING_LOCAL_URL`, ya definida en el compose del backend).

## Usarlo

```bash
docker compose --profile embeddings-local up -d embeddings   # la primera vez baja ~2 GB del modelo
# en backend/.env:
#   EMBEDDING_PROVIDER=local
MAIL_TRANSPORT=mailpit docker compose up -d backend          # recrea el backend con el nuevo valor
```

Después, en `/admin/documents`, los documentos indexados con otro proveedor aparecen como
"Requiere reindexar": usá **Reindexar desactualizados**.

- **Caché del modelo**: volumen con nombre `embeddings-data` (`/data`); sobrevive a recrear el
  contenedor. Para liberarlo: `docker compose --profile embeddings-local rm -sf embeddings && docker volume rm iot-app-base_embeddings-data`.
- **Salud**: el `healthcheck` pasa a healthy cuando el modelo terminó de cargar (puede tardar un par
  de minutos en frío). Logs: `docker compose --profile embeddings-local logs embeddings`.
- **Probar a mano** (sin puerto en el host):
  `docker compose exec embeddings curl -s -X POST http://127.0.0.1:80/v1/embeddings -H 'Content-Type: application/json' -d '{"input":["hola"]}'`
- **Rendimiento**: en CPU un lote de fragmentos tarda segundos; el cliente usa lotes de 8 y un
  tiempo de espera de 120 s. Para GPU habría que cambiar la imagen por la variante CUDA.
- **Alternativa**: Ollama sirve el mismo modelo (`bge-m3`) con `/v1/embeddings`; bastaría apuntar
  `EMBEDDING_LOCAL_URL` allí.

> Cambiar de proveedor o de modelo no mezcla vectores: cada fragmento guarda con qué se generó y la
> consulta sólo usa los del proveedor y modelo actuales. Hasta reindexar, esos documentos no
> aparecen en las respuestas.
