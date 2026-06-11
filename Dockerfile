FROM mcr.microsoft.com/playwright:v1.44.0-jammy
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN npm i -g pnpm && pnpm install
COPY . .
ENV PORT=3333
EXPOSE 3333
CMD ["pnpm", "start"]
