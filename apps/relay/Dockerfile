FROM node:22-slim
WORKDIR /relay
COPY src ./src
ENV PORT=8790
EXPOSE 8790
USER node
CMD ["node", "src/index.mjs"]
