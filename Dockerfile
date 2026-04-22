# Stage 1: Build Environment
FROM node:22-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package descriptors first to leverage Docker cache
COPY package*.json ./

# Install all dependencies (including devDependencies needed for build)
RUN npm ci

# Copy the rest of the application code
COPY . .

# Build both frontend (Vite) and backend (tsup)
RUN npm run build

# Stage 2: Production Runtime Environment
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# Copy package descriptors
COPY package*.json ./

# Install ONLY production dependencies
RUN npm ci --omit=dev

# Copy the built artifacts from the builder stage
COPY --from=builder /app/dist ./dist

# Expose the correct port
EXPOSE 3000

# Start the application using compiled JavaScript
CMD ["npm", "start"]
