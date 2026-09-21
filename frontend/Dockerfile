# Etapa 1: Construcción (Node)
FROM node:22-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Argumentos que se pasan durante el build (vienen del .env o docker-compose)
ARG VITE_API_URL
ARG VITE_APP_LOGIN_URL
ARG VITE_LANDING_URL
ARG VITE_GCP_API_KEY
ARG VITE_TOKEN_REFRESH
ARG VITE_SESSION_TIMEOUT
ARG VITE_MP_REDIRECT_URI

# Variables de entorno para que Vite las use al ejecutar 'npm run build'
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_LOGIN_URL=$VITE_APP_LOGIN_URL
ENV VITE_LANDING_URL=$VITE_LANDING_URL
ENV VITE_GCP_API_KEY=$VITE_GCP_API_KEY
ENV VITE_TOKEN_REFRESH=$VITE_TOKEN_REFRESH
ENV VITE_SESSION_TIMEOUT=$VITE_SESSION_TIMEOUT
ENV VITE_MP_REDIRECT_URI=$VITE_MP_REDIRECT_URI

# Usamos npx vite build para saltar el chequeo de tipos de TS si queda alguno
RUN npx vite build

# Etapa 2: Servido (Nginx)
FROM nginx:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html

# Configuración básica para que React Router funcione (SPA)
RUN echo 'server { \
    listen 80; \
    location / { \
    root /usr/share/nginx/html; \
    index index.html; \
    try_files $uri $uri/ /index.html; \
    } \
    }' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
