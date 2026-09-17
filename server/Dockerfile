FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.mjs ./
COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts
COPY content ./content
COPY vendor ./vendor
ENV PORT=8080
ENV CONTENT_ROOT=/app/content
EXPOSE 8080
CMD ["npm", "start"]
