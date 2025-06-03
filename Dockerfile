FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Create necessary directories with proper permissions
RUN mkdir -p logs data && \
    mkdir -p logs/clients && \
    mkdir -p data/clients && \
    chown -R node:node /app

# Set environment variables
ENV NODE_ENV=production

CMD ["npm", "start"] 