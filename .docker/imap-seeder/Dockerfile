FROM node:22-alpine
WORKDIR /app
COPY package.json .
RUN npm install --silent
COPY seed.ts .
COPY mails/ /mails/
CMD ["npx", "tsx", "seed.ts"]
